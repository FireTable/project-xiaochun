cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.22"
  sha256 arm:   "c9c2ec2be3b6b99f9a5e3ad5479cb23c1035eb1f54e7719b530c113160834d80",
         intel: "01f3e179a33e565cf6496535e8972daab08f94292553e570c1af5077686bd3f4"

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
