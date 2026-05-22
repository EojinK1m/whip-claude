# whip-claude

macOS 메뉴바 트레이 앱. 트레이 아이콘을 누르면 작은 버블 창이 떨어지고, 마우스 커서 대신 verlet-rope 채찍이 따라옵니다. 채찍을 캐릭터에 휘두르면 크랙 소리가 납니다.

Tauri 2 (Rust) + Vanilla TS + Canvas2D + Web Audio.

## 빌드 & 실행

```sh
git clone https://github.com/EojinK1m/whip-claude.git
cd whip-claude
npm install
npm run tauri dev        # 개발 실행
npm run tauri build      # 빌드 (.app / .dmg → src-tauri/target/release/bundle/)
```

요구 사항: Rust 1.85+, Node.js 18+.

## 커스터마이즈

- **캐릭터**: `src/assets/character.svg` 교체
- **채찍 길이/탄성**: `src/main.ts` 상단의 `SEGMENT_COUNT`, `SEGMENT_LEN`, `DAMPING`, `GRAVITY`
- **사운드 톤**: `crack()` 함수의 bandpass 파라미터
- **창 크기**: `src-tauri/tauri.conf.json`의 `width`/`height`
