cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.2"
  sha256 arm:   "760e89dbe4dbac36e5d47c3c52f52e562854d3a745994c973aef59d3ce714cc8",
         intel: "7d0f50a693e15d71453a69fc5658a62c322c4f09244cf136d0e839e0cd565311"

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
