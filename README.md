# App Store release action

这是一个可以自动发布版本到 Halo 应用市场的 GitHub Action。

> ⚠️ 由于目前 Halo 的应用市场暂不支持三方开发者发布应用，所以此 Action 暂时只能够提供给 [halo-dev](https://github.com/halo-dev) 和 [halo-sigs](https://github.com/halo-sigs) 组织使用。

## 使用方式

```yaml
  app-store-release:
    runs-on: ubuntu-latest
    needs: build
    if: github.event_name == 'release'
    steps:
      - uses: actions/checkout@v2
        with:
          submodules: true
      - name: Download plugin-foo jar
        uses: actions/download-artifact@v2
        with:
          name: plugin-foo
          path: build/libs
      - name: Sync to Halo App Store
        uses: halo-sigs/app-store-release-action@main
        with:
          github-token: ${{secrets.GITHUB_TOKEN}}
          app-id: ${{secrets.APP_ID}}
          release-id: ${{ github.event.release.id }}
          assets-dir: "build/libs"
          halo-username: ${{ secrets.HALO_USERNAME }}
          halo-password: ${{ secrets.HALO_PASSWORD }}
```

参数说明：

- `app-id`：应用 ID，可以在 Halo 官网后台的应用管理中找到，必须先创建应用。
- `release-id`：保持不变即可，用于或者当前 GitHub Release 的信息，以同步到 Halo 应用版本。
- `assets-dir`：应用的构建产物目录，在创建版本的时候会将此目录的所有文件上传到应用版本的 Assets 中。
- `halo-username`：Halo 官网后台的用户名。
- `halo-password`：Halo 官网后台的密码。

## 使用示例

```yaml
name: Build Plugin JAR File

on:
  push:
    branches: [ main ]
  release:
    types:
      - created

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
        with:
          submodules: true
      - name: Set up JDK 17
        uses: actions/setup-java@v2
        with:
          distribution: 'temurin'
          cache: 'gradle'
          java-version: 17
      - name: Build with Gradle
        run: |
          # Set the version with tag name when releasing
          version=${{ github.event.release.tag_name }}
          version=${version#v}
          sed -i "s/version=.*-SNAPSHOT$/version=$version/1" gradle.properties
          ./gradlew clean build -x test
      - name: Archive plugin-starter jar
        uses: actions/upload-artifact@v2
        with:
          name: plugin-starter
          path: |
            build/libs/*.jar
          retention-days: 1

  halo-store-release:
    runs-on: ubuntu-latest
    needs: build
    if: github.event_name == 'release'
    steps:
      - uses: actions/checkout@v2
        with:
          submodules: true
      - name: Download plugin-starter jar
        uses: actions/download-artifact@v2
        with:
          name: plugin-starter
          path: build/libs
      - name: Sync to Halo App Store
        uses: halo-sigs/halo-store-release-action@main
        with:
          github-token: ${{secrets.GITHUB_TOKEN}}
          app-id: ${{secrets.APP_ID}}
          release-id: ${{ github.event.release.id }}
          assets-dir: "build/libs"
          halo-username: ${{ secrets.HALO_USERNAME }}
          halo-password: ${{ secrets.HALO_PASSWORD }}
```
