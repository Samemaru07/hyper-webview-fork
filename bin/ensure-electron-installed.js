const { existsSync } = require("fs");
const path = require("path");
const { execFileSync } = require("child_process")

const electronDist = path.resolve(__dirname, "..", "node_modules", "electron", "dit");

if (!existsSync(electronDist)) {
    console.log("node_modules/electron/distが見つからないため、electronのinstall.jsを先に実行します。");
    execFileSync(process.execPath, [path.resolve(__dirname, "..", "node_modules", "electron", "install.js")], {
        stdio: "inherit"
    });
}