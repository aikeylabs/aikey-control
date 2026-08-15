package shared

import (
	"encoding/json"
	"reflect"
)

// EnsureEmptyCollections returns a detached response graph in which nil slices
// are empty slices. The caller's value is never modified.
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
// response crosses, not in each of ~170 handlers' memory.
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
// WHY DETACHED: response DTOs may contain cached maps/pointers shared by two
// simultaneous handlers. The old in-place normalizer called SetMapIndex on
// those shared maps and made two read-only GET /key-delivery requests crash the
// whole Control process with "concurrent map writes". A response serializer
// must be observational: it may change wire representation, never application
// state. JSON() must encode the RETURN VALUE, not its argument.
func EnsureEmptyCollections(v any) any {
	if v == nil {
		return v
	}
	return cloneWithEmptySlices(reflect.ValueOf(v), 0).Interface()
}

var jsonMarshalerType = reflect.TypeOf((*json.Marshaler)(nil)).Elem()

// maxNormalizeDepth bounds the walk. encoding/json itself rejects cyclic
// values, but this walk runs BEFORE the encoder and must not be the thing
// that hangs first. 64 comfortably exceeds any real response nesting.
const maxNormalizeDepth = 64

func cloneWithEmptySlices(rv reflect.Value, depth int) reflect.Value {
	if depth > maxNormalizeDepth || !rv.IsValid() {
		return rv
	}
	t := rv.Type()
	// A type that marshals itself owns its wire shape — do not look inside.
	if t.Implements(jsonMarshalerType) || (rv.CanAddr() && reflect.PtrTo(t).Implements(jsonMarshalerType)) {
		return rv
	}

	switch rv.Kind() {
	case reflect.Ptr:
		if rv.IsNil() {
			return rv
		}
		out := reflect.New(t.Elem())
		out.Elem().Set(cloneWithEmptySlices(rv.Elem(), depth+1))
		return out
	case reflect.Interface:
		if rv.IsNil() {
			return rv
		}
		out := reflect.New(t).Elem()
		out.Set(cloneWithEmptySlices(rv.Elem(), depth+1))
		return out
	case reflect.Struct:
		out := reflect.New(t).Elem()
		out.Set(rv)
		for i := 0; i < rv.NumField(); i++ {
			if t.Field(i).PkgPath != "" { // unexported: not marshalled, not settable
				continue
			}
			out.Field(i).Set(cloneWithEmptySlices(rv.Field(i), depth+1))
		}
		return out
	case reflect.Slice:
		if t.Elem().Kind() == reflect.Uint8 {
			return rv // []byte / json.RawMessage: marshals as string/raw, not array
		}
		if rv.IsNil() {
			return reflect.MakeSlice(t, 0, 0)
		}
		out := reflect.MakeSlice(t, rv.Len(), rv.Len())
		for i := 0; i < rv.Len(); i++ {
			out.Index(i).Set(cloneWithEmptySlices(rv.Index(i), depth+1))
		}
		return out
	case reflect.Array:
		out := reflect.New(t).Elem()
		for i := 0; i < rv.Len(); i++ {
			out.Index(i).Set(cloneWithEmptySlices(rv.Index(i), depth+1))
		}
		return out
	case reflect.Map:
		if rv.IsNil() {
			return rv // nil maps deliberately retain JSON null semantics
		}
		out := reflect.MakeMapWithSize(t, rv.Len())
		for _, k := range rv.MapKeys() {
			out.SetMapIndex(k, cloneWithEmptySlices(rv.MapIndex(k), depth+1))
		}
		return out
	default:
		return rv
	}
}
