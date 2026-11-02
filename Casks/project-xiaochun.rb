cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.2.4"
  sha256 arm:   "3181b6dc73c72e404a47a94bcc901beaa2f74ac4d0800aab14f64c536a6838df",
         intel: "bf2bc1f8c33278edae3b7bc4469a691054f735e13703c13e83c0785e6b758a79"

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
