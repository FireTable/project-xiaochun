cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.28"
  sha256 arm:   "a07d0b5183dc7ea2853058291f7233b05fbaed97e548cfb81bf95802b98cbecf",
         intel: "3d15cf0521151b64528078432613b2003ae1a68d6930793eea7bfeae68f7a2a2"

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
