#!/bin/bash
cp "/Users/toonnelissen/.gemini/antigravity/brain/775052ea-e2d4-470e-a4a8-a64a6fbc422e/dmx_icon_concept_2_1777281652397.png" icon.png
mkdir -p OrbitDMX.iconset
sips -s format png -z 16 16     icon.png --out OrbitDMX.iconset/icon_16x16.png
sips -s format png -z 32 32     icon.png --out OrbitDMX.iconset/icon_16x16@2x.png
sips -s format png -z 32 32     icon.png --out OrbitDMX.iconset/icon_32x32.png
sips -s format png -z 64 64     icon.png --out OrbitDMX.iconset/icon_32x32@2x.png
sips -s format png -z 128 128   icon.png --out OrbitDMX.iconset/icon_128x128.png
sips -s format png -z 256 256   icon.png --out OrbitDMX.iconset/icon_128x128@2x.png
sips -s format png -z 256 256   icon.png --out OrbitDMX.iconset/icon_256x256.png
sips -s format png -z 512 512   icon.png --out OrbitDMX.iconset/icon_256x256@2x.png
sips -s format png -z 512 512   icon.png --out OrbitDMX.iconset/icon_512x512.png
sips -s format png -z 1024 1024 icon.png --out OrbitDMX.iconset/icon_512x512@2x.png
iconutil -c icns OrbitDMX.iconset
rm -rf OrbitDMX.iconset
