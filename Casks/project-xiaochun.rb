cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.7"
  sha256 arm:   "6ab10876749f647d1044bd7e25b859ff8d13cd7ca074fb319a0d2dcffacc1e9e",
         intel: "42f424682443098a7f59ba23d428624549c3cc399e1e7f3b9b76a146e591b5e5"

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
