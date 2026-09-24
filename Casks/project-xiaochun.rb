cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.12"
  sha256 arm:   "93c0f65c630f11c384cd6fb288c75d37a80e0fd679603e0cba7f843579881fee",
         intel: "860fd68f0a8c6a778ea0ad2fb986557057d1a8f7fe674125b3c6306057127c9c"

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
