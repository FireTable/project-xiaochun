cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.22"
  sha256 arm:   "a23e7ae3818d70f2491e212eda6beb95a41a9536057a7bad67c24ae5001696b9",
         intel: "09ddaf3f1f55e5781e31ce1f945101deb144e3e08fcce6ce1007e677c3826b9c"

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
