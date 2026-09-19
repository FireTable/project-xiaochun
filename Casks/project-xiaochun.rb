cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.5"
  sha256 arm:   "b7af076db28e976c35c0a83b88d91a890c8c2afaacfebbfe93c69190f3178f8e",
         intel: "0c82cc013c3144a7061e82d446dfc6faa9e3a56b2d62016feb220a98ba076e6b"

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
