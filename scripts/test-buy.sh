#!/bin/bash
curl -s -X POST http://127.0.0.1:40001/message \
  -H 'Content-Type: application/json' \
  -d '{"text":"compra 0.01 ETH"}'
echo