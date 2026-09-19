cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.4"
  sha256 arm:   "74b7b560cc6f20e25ca5a67599ec7c5b45449251637094172befe95d0d3a2cdd",
         intel: "576c0001a6377b33bd8db0c656f2dcfe765438a207ebd8d68613f4fcbc1a47cb"

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
