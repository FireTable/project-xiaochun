cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.8"
  sha256 arm:   "f8328f250e9a25372dc9409650d0e70f48661c210aee091bcafb2e1bbdda9b1a",
         intel: "7f50cf1104e81d66538f00fa74d848a2140a31f829b2d6ad64f4c8eb9917d09e"

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
