cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.37"
  sha256 arm:   "8a30940160ecb15d38bef7701a65508eb2888b8fe75120993bd5505d9f756669",
         intel: "afe88d9444214a6b5eeb262d6b0a231a539698102bf52bd511dbeeb95d462dd0"

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
