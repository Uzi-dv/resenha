const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: {
      offscreen: true
    }
  });

  const svgPath = path.resolve(__dirname, '../public/favicon.svg');
  const svgContent = fs.readFileSync(svgPath, 'utf-8');
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body, html {
            margin: 0;
            padding: 0;
            width: 512px;
            height: 512px;
            background: transparent;
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          svg {
            width: 460px;
            height: auto;
            max-height: 440px;
            filter: drop-shadow(0 10px 20px rgba(0,0,0,0.45));
          }
        </style>
      </head>
      <body>
        ${svgContent}
      </body>
    </html>
  `;

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 600));

  const image = await win.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  const pngBuffer = image.toPNG();
  fs.writeFileSync(path.resolve(__dirname, '../electron/icon.png'), pngBuffer);

  const img256 = image.resize({ width: 256, height: 256 });
  const png256 = img256.toPNG();

  // Create ICO format container with embedded 256x256 PNG
  const icoHeader = Buffer.alloc(6);
  icoHeader.writeUInt16LE(0, 0); // reserved
  icoHeader.writeUInt16LE(1, 2); // icon type
  icoHeader.writeUInt16LE(1, 4); // count of images

  const icoEntry = Buffer.alloc(16);
  icoEntry.writeUInt8(0, 0); // width (0 = 256)
  icoEntry.writeUInt8(0, 1); // height (0 = 256)
  icoEntry.writeUInt8(0, 2); // color palette (0 = no palette)
  icoEntry.writeUInt8(0, 3); // reserved
  icoEntry.writeUInt16LE(1, 4); // color planes
  icoEntry.writeUInt16LE(32, 6); // bits per pixel
  icoEntry.writeUInt32LE(png256.length, 8); // image size in bytes
  icoEntry.writeUInt32LE(22, 12); // offset of image data (6 + 16 = 22)

  const icoBuffer = Buffer.concat([icoHeader, icoEntry, png256]);
  fs.writeFileSync(path.resolve(__dirname, '../electron/icon.ico'), icoBuffer);

  const buildDir = path.resolve(__dirname, '../build');
  if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir);
  }
  fs.writeFileSync(path.join(buildDir, 'icon.png'), pngBuffer);
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), icoBuffer);

  console.log('Icon PNG & ICO successfully generated at electron/ and build/!');
  app.quit();
});
