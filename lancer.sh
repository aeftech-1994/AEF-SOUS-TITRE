#!/bin/bash

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

cd "/Users/aefv/Documents/AEF-master 2/AEF_subtitles_v2" || exit 1


git pull 

npm start