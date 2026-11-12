cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.2.14"
  sha256 arm:   "73292288310bc5e2e8aefc10328c1dc573530801fda0f1fae308427ec8c8fa1a",
         intel: "97d17170ca7ae1589462bbd13eb70c65e38ebcc32414a32f7ade02ce6e9d9901"

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
