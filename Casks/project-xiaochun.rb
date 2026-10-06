cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.16"
  sha256 arm:   "e6978785574933cb39e3e2f50da0bf914e6fef106d2c9ac1a4185d22535c6435",
         intel: "80732df8ff71c995f6ef0ed5704c0172b59b225363f63245b0e2a9644cc44ccb"

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
