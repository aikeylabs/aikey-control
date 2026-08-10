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
	github.com/AiKeyLabs/aikey-data/baseline v0.0.0-00010101000000-000000000000 // indirect
	github.com/dustin/go-humanize v1.0.1 // indirect
	github.com/kr/text v0.2.0 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/ncruces/go-strftime v1.0.0 // indirect
	github.com/remyoudompheng/bigfft v0.0.0-20230129092748-24d4a6f8daec // indirect
	modernc.org/libc v1.70.0 // indirect
	modernc.org/mathutil v1.7.1 // indirect
	modernc.org/memory v1.11.0 // indirect
)

require (
	github.com/AiKeyLabs/aikey-config-tool v0.0.0-00010101000000-000000000000
	golang.org/x/sys v0.43.0 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
	modernc.org/sqlite v1.48.2
)

replace github.com/AiKeyLabs/pkg/providerroutes => ../../pkg/providerroutes

replace github.com/AiKeyLabs/pkg/aikeycompat => ../../pkg/aikeycompat

replace github.com/AiKeyLabs/aikey-config-tool => ../../aikey-config-tool

replace github.com/AiKeyLabs/aikey-data/baseline => ../../aikey-data/baseline
