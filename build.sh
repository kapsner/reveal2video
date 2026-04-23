#!/bin/bash

npm install
npm install -g pkg
pkg . --targets node18-linux-x64 --output reveal2video
mkdir -p ~/bin
mv reveal2video ~/bin/
