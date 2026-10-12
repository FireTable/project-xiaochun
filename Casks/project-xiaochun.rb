cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.22"
  sha256 arm:   "60edf719091e4c892206443b728cbebe8b6aad5e45ab00158ce6448a3baf2eed",
         intel: "4874f8aef0ce30226e672d2e4de79f80aa50f4a189af0480b16ee698d8b54efa"

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
