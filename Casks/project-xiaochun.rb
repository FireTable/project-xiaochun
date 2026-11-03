cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.2.7"
  sha256 arm:   "16f5cb0535afe39fe2a0fdf479030f5c289ec9db269cedb6e3d6d0545052b1e6",
         intel: "6778211804b14d9fc98364fcc11c13348458585d1e8578d19164c71fd28b16db"

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
