cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.3"
  sha256 arm:   "284546fb16daf057358bb5ad5fc28ab7969fabfcae332ef1e3dfd263f18d7369",
         intel: "76932e13ac6a0bbbc6c99eb56f123dc3670c103722e69c1062fc4d62b9ae22a3"

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
