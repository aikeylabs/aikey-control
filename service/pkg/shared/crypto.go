package shared

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
)

// AESEncryptor implements AES-256-GCM encryption.
//
// Format stored in DB:
//   base64( nonce[12] || ciphertext || tag[16] )
//
// The master key (32 bytes) is loaded from the environment once at startup.
// For a full envelope-encryption scheme (DEK per credential wrapped by KEK),
// extend this to store the wrapped DEK alongside each ciphertext row.
// TODO(evolution): replace with KMS-backed envelope encryption when required.
type AESEncryptor struct {
	gcm cipher.AEAD
}

// NewAESEncryptor creates an AESEncryptor from a 32-byte master key.
func NewAESEncryptor(masterKey []byte) (*AESEncryptor, error) {
	if len(masterKey) != 32 {
		return nil, fmt.Errorf("master key must be 32 bytes, got %d", len(masterKey))
	}
	block, err := aes.NewCipher(masterKey)
	if err != nil {
		return nil, fmt.Errorf("create AES cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create GCM: %w", err)
	}
	return &AESEncryptor{gcm: gcm}, nil
}

// Encrypt seals plaintext with AES-256-GCM and returns a base64-encoded blob.
func (e *AESEncryptor) Encrypt(plaintext string) (string, error) {
	nonce := make([]byte, e.gcm.NonceSize()) // 12 bytes
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("generate nonce: %w", err)
	}
	// Seal appends tag to ciphertext automatically.
	sealed := e.gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

// Decrypt reverses Encrypt. Returns the original plaintext or an error.
func (e *AESEncryptor) Decrypt(encoded string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", fmt.Errorf("base64 decode: %w", err)
	}
	nonceSize := e.gcm.NonceSize()
	if len(data) < nonceSize {
		return "", errors.New("ciphertext too short")
	}
	nonce, ciphertext := data[:nonceSize], data[nonceSize:]
	plain, err := e.gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("decrypt: %w", err)
	}
	return string(plain), nil
}

// GenerateOpaqueToken returns a URL-safe base64-encoded random token and its
// SHA-256 hex hash. The plaintext is sent to clients; only the hash is stored
// in the database so the plaintext cannot be recovered from a DB breach.
func GenerateOpaqueToken() (plaintext, hash string, err error) {
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		err = fmt.Errorf("generate opaque token: %w", err)
		return
	}
	plaintext = base64.RawURLEncoding.EncodeToString(b)
	h := sha256.Sum256([]byte(plaintext))
	hash = hex.EncodeToString(h[:])
	return
}

// HashToken returns the SHA-256 hex hash of a client-supplied plaintext token.
// Use this to look up a stored token hash from a value presented by the client.
func HashToken(plaintext string) string {
	h := sha256.Sum256([]byte(plaintext))
	return hex.EncodeToString(h[:])
}

// MasterKeyFromBase64 decodes a base64-encoded 32-byte master key string
// (e.g. from the MASTER_KEY environment variable).
func MasterKeyFromBase64(encoded string) ([]byte, error) {
	key, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("decode master key: %w", err)
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("master key must decode to 32 bytes, got %d", len(key))
	}
	return key, nil
}
