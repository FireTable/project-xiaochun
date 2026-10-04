cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.15"
  sha256 arm:   "333d1d29d3c5bfbf26e28941cf46ce26ceb6c5cccfd870b9ef01f69856fa3184",
         intel: "60a19c7de1282980989131241d0788b23d6828fc9127893b90b8531db519bd0f"

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
