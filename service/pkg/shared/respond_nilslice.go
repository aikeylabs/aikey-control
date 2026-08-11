package shared

import (
	"encoding/json"
	"reflect"
)

// EnsureEmptyCollections rewrites nil slices to empty slices, in place, on the
// value JSON() is about to encode.
//
// WHY (2026-08-11): Go marshals a nil slice as JSON `null`, and every consumer
// of these APIs reads collection fields as arrays. The same defect has shipped
// FOUR times as four different fields — /user/performance (2026-05-23,
// virtual_key_id rows), cluster_apply `slots:null` (2026-07-16), cluster_apply
// `accounts:null` (2026-07-18), and the seats page `members:null` (2026-07-30)
// that took down the whole admin console and motivated RouteErrorBoundary.
// Each fix corrected one field and fenced that one field; nothing protected
// the NEXT field a handler builds with `var out []T` + a loop that appends
// zero times. This choke point protects fields that do not exist yet.
//
// WHY HERE: shared.JSON is the response exit for the member and master
// services (161 call sites in aikey-control-master alone). Normalizing at the
// single exit is the wire-shape analogue of the project's
// "事件驱动写必配幂等对账读" rule: the guarantee lives on the one path every
// response必经, not in each of ~170 handlers' memory.
//
// WHAT IT DOES NOT TOUCH:
//   - []byte (and json.RawMessage): they marshal as base64 strings / raw JSON,
//     not arrays; nil→empty would silently turn `null` into `""` — a real
//     shape change this fix must not smuggle in.
//   - Types implementing json.Marshaler (time.Time etc.): their wire shape is
//     their own contract; recursing into their fields would be wrong.
//   - Nil maps / nil pointers: `null` for "object absent" is a legitimate
//     signal the frontends already branch on (`x ?? {}` / `if (x)`); the four
//     incidents were all slices, and widening the rewrite beyond the observed
//     defect class would be a wire change nobody asked for.
//   - unexported fields: encoding/json ignores them, and reflect cannot set
//     them anyway.
//
// MUTATION: it writes through pointers, so the caller's struct may gain empty
// slices where it had nil ones. In Go the two are interchangeable for len/cap/
// range/append; handlers hand the value to JSON() as their last act. This is
// deliberate — copying arbitrary response graphs to avoid a semantically
// neutral write would cost more than it protects.
// It returns the value to encode: normally v itself, but when v is a
// non-pointer (unaddressable — reflect cannot write into the caller's copy)
// an addressable copy is fixed and returned instead. JSON() must encode the
// RETURN VALUE, not its argument.
func EnsureEmptyCollections(v any) any {
	if v == nil {
		return v
	}
	rv := reflect.ValueOf(v)
	if rv.Kind() != reflect.Ptr && rv.Kind() != reflect.Map {
		cp := reflect.New(rv.Type())
		cp.Elem().Set(rv)
		ensureEmptySlices(cp.Elem(), 0)
		return cp.Elem().Interface()
	}
	ensureEmptySlices(rv, 0)
	return v
}

var jsonMarshalerType = reflect.TypeOf((*json.Marshaler)(nil)).Elem()

// maxNormalizeDepth bounds the walk. encoding/json itself rejects cyclic
// values, but this walk runs BEFORE the encoder and must not be the thing
// that hangs first. 64 comfortably exceeds any real response nesting.
const maxNormalizeDepth = 64

func ensureEmptySlices(rv reflect.Value, depth int) {
	if depth > maxNormalizeDepth || !rv.IsValid() {
		return
	}
	t := rv.Type()
	// A type that marshals itself owns its wire shape — do not look inside.
	if t.Implements(jsonMarshalerType) || (rv.CanAddr() && reflect.PtrTo(t).Implements(jsonMarshalerType)) {
		return
	}

	switch rv.Kind() {
	case reflect.Ptr, reflect.Interface:
		if !rv.IsNil() {
			ensureEmptySlices(rv.Elem(), depth+1)
		}
	case reflect.Struct:
		for i := 0; i < rv.NumField(); i++ {
			if t.Field(i).PkgPath != "" { // unexported: not marshalled, not settable
				continue
			}
			ensureEmptySlices(rv.Field(i), depth+1)
		}
	case reflect.Slice:
		if t.Elem().Kind() == reflect.Uint8 {
			return // []byte / json.RawMessage: marshals as string/raw, not array
		}
		if rv.IsNil() {
			if rv.CanSet() {
				rv.Set(reflect.MakeSlice(t, 0, 0))
			}
			return
		}
		for i := 0; i < rv.Len(); i++ {
			ensureEmptySlices(rv.Index(i), depth+1)
		}
	case reflect.Array:
		for i := 0; i < rv.Len(); i++ {
			ensureEmptySlices(rv.Index(i), depth+1)
		}
	case reflect.Map:
		// Map VALUES are not addressable; a nil slice sitting directly as a map
		// value must be replaced via SetMapIndex. Deeper structures inside map
		// values are reached through pointers (settable) or copied out, fixed,
		// and written back.
		for _, k := range rv.MapKeys() {
			mv := rv.MapIndex(k)
			if !mv.IsValid() {
				continue
			}
			fixed := normalizeMapValue(mv, depth+1)
			if fixed.IsValid() {
				rv.SetMapIndex(k, fixed)
			}
		}
	}
}

// normalizeMapValue returns a replacement for a map value when it (or
// something reachable inside it by value) needed rewriting, or an invalid
// Value when writing through the original was already possible.
func normalizeMapValue(mv reflect.Value, depth int) reflect.Value {
	if depth > maxNormalizeDepth {
		return reflect.Value{}
	}
	switch mv.Kind() {
	case reflect.Ptr:
		ensureEmptySlices(mv, depth) // writes through the pointer; no replacement needed
		return reflect.Value{}
	case reflect.Interface:
		if mv.IsNil() {
			return reflect.Value{}
		}
		inner := normalizeMapValue(mv.Elem(), depth+1)
		if inner.IsValid() {
			out := reflect.New(mv.Type()).Elem()
			out.Set(inner)
			return out
		}
		return reflect.Value{}
	case reflect.Slice:
		if mv.Type().Elem().Kind() == reflect.Uint8 {
			return reflect.Value{}
		}
		if mv.IsNil() {
			return reflect.MakeSlice(mv.Type(), 0, 0)
		}
		ensureEmptySlices(mv, depth) // elements may hold pointers; walk them
		return reflect.Value{}
	case reflect.Struct, reflect.Map:
		// Copy out, fix the copy, hand it back.
		cp := reflect.New(mv.Type()).Elem()
		cp.Set(mv)
		ensureEmptySlices(cp, depth)
		return cp
	default:
		return reflect.Value{}
	}
}
