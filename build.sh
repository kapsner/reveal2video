#!/bin/bash

npm install
npm run build
mkdir -p ~/bin
mv reveal2video ~/bin/
