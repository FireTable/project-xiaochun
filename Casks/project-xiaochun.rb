cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.2.16"
  sha256 arm:   "0192f93b47192cbac36b96475ea956d84d87004ea1915a4566d7cbb56493a18a",
         intel: "90681bf4d71846b766df3e82ae7a67a0ef23bf18c393fe4bfd8cf9cccbd21917"

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
