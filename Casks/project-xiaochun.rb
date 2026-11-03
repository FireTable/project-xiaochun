cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.2.5"
  sha256 arm:   "8b7eafc3e12c756f294c4c3e520d2b35c1539c805085090b9f69673c006eb62a",
         intel: "56a17c9a415213949fbc41a45370c9567ecece7cd43e4de7353e8192c5393e6d"

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
