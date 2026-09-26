const { execSync } = require("child_process")

function run(arch) {
    execSync(`cross-env npm_config_arch=${arch} pnpm run v8-snapshot:arch`, { stdio: "inherit", shell: true });
}

run("x64");

// macはApple Silicon向けuniversal buildのためarm 64も必要
// Windowsはarm64のクロスビルドが機能しないためx64のみとする (2026-09)
if (process.platform === "darwin") {
    run("arm64");
}