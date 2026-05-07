package shared

import (
	"encoding/base64"
	"strings"
	"testing"
)

func testEncryptor(t *testing.T) *AESEncryptor {
	t.Helper()
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i + 1)
	}
	enc, err := NewAESEncryptor(key)
	if err != nil {
		t.Fatalf("NewAESEncryptor: %v", err)
	}
	return enc
}

func TestAESEncryptor_RoundTrip(t *testing.T) {
	enc := testEncryptor(t)
	plaintext := "sk-openai-supersecret-key-1234567890"

	ciphertext, err := enc.Encrypt(plaintext)
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	if ciphertext == plaintext {
		t.Fatal("ciphertext must differ from plaintext")
	}

	got, err := enc.Decrypt(ciphertext)
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if got != plaintext {
		t.Errorf("Decrypt = %q, want %q", got, plaintext)
	}
}

func TestAESEncryptor_UniqueNonce(t *testing.T) {
	enc := testEncryptor(t)
	plaintext := "same-plaintext"

	c1, _ := enc.Encrypt(plaintext)
	c2, _ := enc.Encrypt(plaintext)
	if c1 == c2 {
		t.Error("each Encrypt call must produce a unique ciphertext (random nonce)")
	}
}

func TestAESEncryptor_TamperedCiphertext(t *testing.T) {
	enc := testEncryptor(t)
	ct, _ := enc.Encrypt("secret")

	// Flip the last byte of the base64-decoded data.
	data, _ := base64.StdEncoding.DecodeString(ct)
	data[len(data)-1] ^= 0xFF
	tampered := base64.StdEncoding.EncodeToString(data)

	if _, err := enc.Decrypt(tampered); err == nil {
		t.Error("expected error for tampered ciphertext, got nil")
	}
}

func TestAESEncryptor_WrongKeySize(t *testing.T) {
	if _, err := NewAESEncryptor(make([]byte, 16)); err == nil {
		t.Error("expected error for 16-byte key, got nil")
	}
}

func TestMasterKeyFromBase64(t *testing.T) {
	key := make([]byte, 32)
	encoded := base64.StdEncoding.EncodeToString(key)
	got, err := MasterKeyFromBase64(encoded)
	if err != nil {
		t.Fatalf("MasterKeyFromBase64: %v", err)
	}
	if len(got) != 32 {
		t.Errorf("len = %d, want 32", len(got))
	}

	// Too short after decode.
	short := base64.StdEncoding.EncodeToString([]byte("tooshort"))
	if _, err := MasterKeyFromBase64(short); err == nil {
		t.Error("expected error for short key")
	}

	// Invalid base64.
	if _, err := MasterKeyFromBase64("not!!base64"); err == nil {
		t.Error("expected error for invalid base64")
	}
	_ = strings.Repeat("A", 44) // silence unused import
}
