cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.22"
  sha256 arm:   "46d9e6f90c1212bcf2295587fb7c71c0880cadea313e1ba5866127db5ec541b3",
         intel: "1aaa816c340cfdfbdbeed5b375e00f42db79ef5745dd9c2ce758a31d4474393a"

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
