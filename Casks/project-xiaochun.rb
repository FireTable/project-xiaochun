cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.2.2"
  sha256 arm:   "15c0e85a0a3693616467f6f07316403e4e6ff0e9ffa9cc50c04d0b8dcb520b20",
         intel: "2a211fb12b25f13e6fc804c9dc6c097b315ba3cd5e1a211ff8195ee6dacacd7b"

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
