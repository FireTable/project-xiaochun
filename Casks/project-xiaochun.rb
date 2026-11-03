cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.2.6"
  sha256 arm:   "473ade4d30ce891565b320169c34b4972ac67506e856c59f1555b522693514c1",
         intel: "7af04c73a0945d7c6af3699796a5021b9b102299e89833c40be57eabbb105e09"

  url "https://github.com/FireTable/project-xiaochun/releases/download/v#{version}/Project.XiaoChun_#{version}_#{arch}.dmg"
  name "Project XiaoChun"
  desc "100% Client-Native Anime Companion & Transparent Desktop Pet"
  homepage "https://github.com/FireTable/project-xiaochun"

  depends_on :macos

  app "Project XiaoChun.app"

  postflight_steps do
    run "/usr/bin/xattr", args: ["-cr", "/Applications/Project XiaoChun.app"]
  end

  zap trash: [
    "~/Library/Application Support/tech.firetable.xiaochun",
    "~/Library/Preferences/tech.firetable.xiaochun.plist",
    "~/Library/Saved Application State/tech.firetable.xiaochun.savedState",
  ]
end
