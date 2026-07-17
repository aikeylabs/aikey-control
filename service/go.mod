module github.com/AiKeyLabs/aikey-control/service

go 1.26.1

require (
	github.com/AiKeyLabs/pkg/aikeycompat v0.0.0
	github.com/AiKeyLabs/pkg/aikeytime v0.1.0
	github.com/AiKeyLabs/pkg/providerroutes v0.0.0
	github.com/golang-jwt/jwt/v5 v5.3.1
	github.com/google/uuid v1.6.0
	github.com/lib/pq v1.12.3
	golang.org/x/crypto v0.50.0
)

require (
	github.com/kr/pretty v0.3.1 // indirect
	github.com/rogpeppe/go-internal v1.10.0 // indirect
	golang.org/x/sys v0.43.0 // indirect
	gopkg.in/check.v1 v1.0.0-20201130134442-10cb98267c6c // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
)

replace github.com/AiKeyLabs/pkg/providerroutes => ../../pkg/providerroutes

replace github.com/AiKeyLabs/pkg/aikeycompat => ../../pkg/aikeycompat
