cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.2.17"
  sha256 arm:   "c78ab8aa1853897b037fc7b47c96bedcae114852ca02cba4a1d34d6a0274844c",
         intel: "89c1bc0f47766ea1beab6d248b5592dcdcacbbcae5148a4646da0387e2dbebbc"

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
