.PHONY: install build test server package smoke

install:
	npm ci

build:
	npm run compile

test:
	npm test

server:
	npm run prepare:server

package: server
	npm run package

smoke:
	npm run test:vscode
