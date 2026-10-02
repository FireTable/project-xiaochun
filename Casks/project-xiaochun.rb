cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.13"
  sha256 arm:   "811592b21b624aac485950f5b037d1ffa33be69d33605d4793c8914f808d6e9f",
         intel: "00af57ca53aa2b5eea1d39cc8f2ca5f673bf211739a9da2dfa8e1371cfa1c32d"

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
