# 機能マップ

最終確認: 2026-10-04（日本時間）

ユーザーから「この機能を変えたい」「ここで失敗する」と依頼されたとき、調査する実装・設定・テストを特定するための開発者向け索引です。ファイル名だけでなく、呼び出し元、処理、依存先、副作用、保証範囲を示します。変更着手時は「最初に見る場所」と末尾の逆引き表から入り、該当する処理フローとテストを確認してください。

Windows上で作業実績Excelを読み、利用者が手動でログインした奉行クラウドの勤務実績申請画面へ入力し、検証・下書き保存・保存内容の再読取後にExcelを移動するローカルCLIです。Node.js 22以降、TypeScript/tsx、SheetJS、Playwright、Zodを使用します。サーバーや独自DBはありません。

現在の `src/`、`tests/`、設定とバッチを正として作成しました。このツールの機能・責務はローカルの実装から確認しています。

重要な安全境界は、手動ログイン・MFA・最終申請、全対象日の事前競合チェック、入力後の再読取、保存確認成功後だけのExcel退避です。現在の本番設定は `verified: true`、`periodSource: rowDates`、`saveMode: reopenDraft`。再確認・画面確認モードからこの設定ファイルを変更する処理はありません。

## 最初に見る場所

表中のテスト名はすべて `tests/` 配下です。詳しい保証範囲と環境条件は「テストマップ」を参照してください。

| 変更したい内容 | 主なファイル | 関連テスト | 注意点 |
| --- | --- | --- | --- |
| 通常実行の順序・終了処理 | `run.bat`, `src/index.ts`, `src/services/attendanceService.ts` | `service.test.ts`, `browser.test.ts`, `draftReopen.test.ts` | 保存・退避の順序、状態フラグ、終了コードを維持 |
| Excelの形式・集計 | `src/excel/reader.ts`, `src/excel/parser.ts`, `src/domain/attendance.ts` | `excel.test.ts` | 未知のレイアウト・日付・数式結果を推測しない |
| 出社・有休・競合・再実行 | `src/services/validationService.ts`, `src/services/attendanceService.ts` | `domain.test.ts`, `service.test.ts`, `browser.test.ts` | 非勤務日の有休は明示指定だけ。全件事前確認 |
| 奉行DOM・入力の確定 | `config/selectors.json`, `src/browser/selectors.ts`, `src/browser/attendancePage.ts`, `src/browser/interactions.ts`, `src/browser/splitInput.ts` | `browser.test.ts`, `dynamicCells.test.ts`, `screenInspection.test.ts` | 表示値と保存済み属性は同じとは限らない |
| 下書き保存・保存値照合 | `src/browser/attendancePage.ts`, `src/browser/draftListPage.ts`, `src/services/attendanceService.ts` | `draftReopen.test.ts`, `browser.test.ts` | 本番は対象月を再オープン。クリックは再試行しない |
| 保存後確認だけを再開 | `verify-draft.bat`, `src/index.ts`, `src/domain/executionMode.ts` | `draftReopen.test.ts` | 起動済みEdgeへ接続可能。入力・保存禁止 |
| 実画面の読取確認 | `check-screen.bat`, `src/checkScreen.ts`, `src/services/screenInspection.ts` | `screenInspection.test.ts` | Excel不要。クリック・ログファイル作成なし |
| Excel退避・ファイル選択 | `src/services/backupService.ts`, `src/utils/file.ts`, `src/utils/date.ts` | `service.test.ts`, `files.test.ts`, `domain.test.ts` | `rename`による移動。同秒ディレクトリを再利用しない |
| Edge・CDP・タブ判定 | `src/browser/edgeLauncher.ts`, `src/browser/findAttendancePage.ts` | `cdp.test.ts`, `browser.test.ts` | 専用プロファイル・localhost接続。終了後もEdgeを保持 |
| 設定・ログ・実行ロック・対話 | `src/domain/config.ts`, `src/utils/logger.ts`, `src/index.ts`, `src/checkScreen.ts`, `src/cli/prompt.ts`, `src/cli/summary.ts` | `domain.test.ts`, `files.test.ts`（部分的） | ログ・ロック・対話全体の直接テストはない |

## 全体アーキテクチャ

```text
バッチ / package.json
  → src/index.ts（normal / verifyDraft）または src/checkScreen.ts
      → cli：選択・質問・確認・表示
      → domain/config：設定の型と検証
      → excel：ファイル読取 → テンプレート解析 → AttendanceRecord[]
      → validationService：明示日指定 → PlannedDay[] → 競合・一致判定
      → attendanceService：事前確認 → 入力 → 検証 → 保存、または下書き再確認
          → AttendancePort / AttendancePage：Playwrightと画面の境界
              → selectors / interactions / splitInput
              → DraftListPage：対象月の下書き探索・詳細・入力画面への移動
      → backupService：検証・保存確認済みならExcel移動
      → utils：日付・ファイル検出・ログ
```

| ファイル | 責務と主な呼び出し関係 |
| --- | --- |
| `src/index.ts` | `main`が通常実行と再確認の共通準備、分岐、ロック、ログ、状態管理、切断、退避、終了コードを担当。DOM操作そのものはPage Objectへ委譲 |
| `src/checkScreen.ts` | 独立した読取確認入口。設定・ロック・対話・Edge・`inspectScreen`・コンソール出力を組み立てる。`main`を呼ばない |
| `src/domain/attendance.ts` | `Period`, `AttendanceRecord`, `Fields`, `PlannedDay`, `AttendanceCodes`と`UserError`, `ensure`。Excel値と画面期待値の共通契約 |
| `src/domain/config.ts` | `settingsSchema`, `Settings`, `loadSettings`。設定JSONの構造と日時書式の検証 |
| `src/domain/executionMode.ts` | `ExecutionMode`, `executionMode`。引数なし／`--verify-draft`以外を拒否。check-screenは別入口 |
| `src/excel/reader.ts` | `ExcelReader`, `SheetJsReader`, `readWorkbook`。拡張子からReaderを選択しSheetJSの`WorkBook`を生成 |
| `src/excel/parser.ts` | `parseWorkbook`。固定セル配置を検証し、日付・時間・合計を`AttendanceRecord[]`へ変換 |
| `src/services/validationService.ts` | `buildPlan`, `normalize`, `normalized`, `equals`, `conflicts`。業務上の期待値と比較規則。ブラウザやファイルを操作しない |
| `src/services/attendanceService.ts` | `RunState`, `initialState`, `enterAndSave`, `verifySavedDraft`。実行順序・検算・成功フラグ。DOMの詳細はportへ委譲 |
| `src/services/screenInspection.ts` | `inspectScreen`。portの`assertPeriod`と`read`だけを受け取り、全日付・6項目と確認日を読む |
| `src/services/backupService.ts` | `fingerprint`, `backupFile`。SHA-256による変更検知と保存確認後のファイル移動 |
| `src/browser/edgeLauncher.ts` | `launchEdge`, `connectEdge`, `disconnect`。Edgeプロセス・専用プロファイル・CDP接続の境界 |
| `src/browser/findAttendancePage.ts` | `findAttendancePage`。全contextのタブを調べ、モードごとの対象候補を一意に特定 |
| `src/browser/selectors.ts` | `selectorsSchema`, `inspectionSelectorsSchema`, `selectorsForRun`と設定の型。JSONの読込自体は各入口が行う |
| `src/browser/interactions.ts` | `unique`, `waitUntil`, `waitVisible`, `safeClick`。要素一意性・表示待ち・クリック対象の安全確認 |
| `src/browser/splitInput.ts` | `timeParts`, `decimalParts`による入力分割。`readTimeParts`, `readDecimalParts`も定義するが現在の本番読取はこれらを使わずセル表示を読む |
| `src/browser/attendancePage.ts` | `AttendancePort`, `AttendancePage`。対象年月・行・現在値、入力、再読取検証、保存、再オープンを担当。入力予定・競合規則の作成やExcel退避は担当しない |
| `src/browser/draftListPage.ts` | `DraftListPage.openMonth`, `openListedMonth`。一覧の準備・状態/申請名/全月期間による一意な対象探索、詳細→申請書入力。勤怠値照合は`AttendancePage`へ戻す |
| `src/cli/prompt.ts` | `Prompt.question`, `confirm`, `retry`, `choose`, `close`。対話のみ。業務検証は呼び出し元のコールバック |
| `src/cli/summary.ts` | `summary`, `leaveWarning`。計画・時間合計・未指定有休の手動入力案内を文字列化 |
| `src/utils/date.ts` | 年月、月日数、日指定、画面期間、下書き期間、日本時間timestampの共通処理 |
| `src/utils/file.ts` | `discover`。input直下の命名規則・拡張子に合う通常ファイルを列挙 |
| `src/utils/logger.ts` | `createLogger`。呼び出し元のメッセージをコンソールとログへ出力 |

依存方向は厳密な一方向ではありません。`AttendancePage`はservicesの正規化・一致判定を使い、servicesはbrowserの`AttendancePort`を型として参照します。純粋な判定を変更すると、入力前だけでなく読取・入力後・保存後の検証にも影響します。

## 実行入口

| 実行方法 | Entry point | 用途 | 書込み有無 |
| --- | --- | --- | --- |
| `run.bat` / `npm start` | `node node_modules/tsx/dist/cli.mjs src/index.ts` / `tsx src/index.ts` → `main` | Excel転記から保存・再照合・退避 | 勤怠入力・下書き保存1回・Excel移動・ログ・ロック/プロファイル |
| `verify-draft.bat` | 同じ`src/index.ts`に`--verify-draft` → `ExecutionMode: verifyDraft` | 保存済み下書きの照合を再開 | 画面遷移クリックと成功時のExcel移動・ログ等。勤怠入力・保存・申請なし |
| `check-screen.bat` | `node node_modules/tsx/dist/cli.mjs src/checkScreen.ts` | 実画面の日付/項目の読取確認 | 画面書込み・クリック・Excel操作・ログ作成なし。ロック/プロファイルは使用 |

各batはUTF-8へ切替、batの所在へ`cd`、Nodeとtsxの存在確認、終了コード取得、`pause`、同じコードで終了を行います。Nodeの最低バージョン指定は`package.json`の`engines`で、batの`where node`はバージョンを検査しません。`index.ts`と`checkScreen.ts`も自身の場所を基にプロジェクトルートへ`chdir`するため、設定の相対パスはルート基準です。

## 通常実行の処理フロー

```text
run.bat → Node / tsx → src/index.ts main → executionMode([]) = normal
  → .runtime/run.lockを排他的作成 → createLogger('logs') → loadSettings
  → discover → Prompt.choose（1件なら自動選択、複数なら番号）
  → fingerprint → periodFromFilename → readWorkbook → parseWorkbook
  → fingerprint再照合（解析中の変更を拒否）
  → Prompt.retry + parseDays + buildPlan（出社日、次に有休日）
  → buildPlan → summary / 非対象SKIP / 有休未指定案内 → 対象0件を拒否
  → Prompt.confirm（[Y/n]、Enterでも続行）→ キャンセルなら終了
  → selectorsForRun(normal)（verified=true必須）
  → launchEdge → 手動ログイン・MFA・対象入力画面への移動 → Enter待機
  → connectEdge → findAttendancePage(normal)
  → enterAndSave
      → AttendancePage.assertPeriod（本番は全日付属性・表示を照合）
      → 全planをread → conflictsを集約 → 競合があれば入力ゼロで停止
      → 各日を再readしsnapshotとの変更を拒否
          → equalsならALREADY OK、異なればwrite → verify
      → assertPeriod再確認 → 全planをverify → 対象日数・実働・休憩合計を検算
      → state.verified=true / state.saveAttempted=true → saveDraft
          → saveAndReopen：下書き保存を1回クリック
          → reopenDraft：申請期間への遷移確認
          → DraftListPage.openMonth：一覧 → 対象月 → 詳細 → 申請書入力
          → verifyOpenedDraft：準備待ち → 年月 → 全対象日6項目の照合
      → state.saved=true
  → disconnect（専用Edgeは保持）
  → backupFile（saved && verified、場所・hash・衝突を検査）
  → 正常0 / バックアップのみ失敗2 / その他の例外1
  → finally：残ったCDP接続の切断、Prompt.close、ロック削除
```

`enterAndSave`が「入力→保存」を統括し、本番の保存後照合は`saveDraft`の内部に含まれます。通常実行で`verifySavedDraft`を追加でもう一度呼ぶ構造ではありません。途中失敗の自動ロールバックはなく、一部入力が画面に残る可能性を状態表示で知らせます。中止は通常終了で、ブラウザ・Excelは変更しませんが、その前にロックとログは使用しています。

## verify-draft の処理フロー

```text
verify-draft.bat → src/index.ts main → executionMode(['--verify-draft'])
  → 通常と共通：ロック・ログ・設定・Excel選択/解析/hash・出社/有休・plan・確認
  → selectorsForRun(verifyDraft)：未確認設定も構造検証し、メモリ上のverified=false
  → connectEdge(port, 2000)で既存専用Edgeを試す → 失敗したらlaunchEdge
  → 手動ログイン等 → 「申請期間」「下書き:N件」の画面でEnter
  → 必要ならconnectEdge → findAttendancePage(verifyDraft)
  → verifySavedDraft：state.verified/state.savedをfalseへ
      → AttendancePage.reopenDraft → DraftListPage.openMonth
      → verifyOpenedDraft → assertPeriod → 全planのverify
      → 成功時のみstate.verified/state.saved=true
  → disconnect → backupFile → summary / 完了表示 → finally
```

保存時と同じExcel・出社日・有休日で期待値を再構築します。既存入力画面ではなく、保存後の申請期間画面を探すモードです。`matchesSavedReturn`と`reopenDraft`は`saveMode: reopenDraft`が必要です。下書き一覧へ移動するクリックはありますが、勤怠欄への書込みはありません。

`verifySavedDraft`の引数は`reopenDraft`だけを持つportです。通常用の`enterAndSave`を呼びません。さらに`AttendancePage.write`/`saveDraft`が`mode === verifyDraft`を拒否し、設定がtrueでも実行できません。`selectorsForRun`もメモリ上の`verified`をfalseにします。設定ファイルは更新せず、申請・削除メソッドもありません。成功しても`inputStarted`と`saveAttempted`はfalseで、`saved`は「既存下書きの保存内容を確認済み」の意味です。失敗時はExcelを退避しません。

## check-screen の処理フロー

```text
check-screen.bat → src/checkScreen.ts（独立入口）
  → loadSettings → inspectionSelectorsSchema → メモリ上のverified=false
  → 共通の.runtime/run.lock作成 → Prompt
  → YYYYMM入力・確認日入力（月の範囲検証）
  → launchEdge → 手動ログイン・入力画面へ移動・編集確定 → Enter
  → connectEdge → findAttendancePage(normal)
  → inspectScreen：assertPeriod → 月の1日から末日をすべてread
  → 成功日数と確認日の6項目をconsole.log → 切断・Prompt.close・ロック削除
```

`ExecutionMode`にcheck-screenという値はありません。画面探索はnormalの入力画面識別を使い、未確認のPage Objectで読取だけを行います。`inspectScreen`の型は`Pick<AttendancePort, 'assertPeriod' | 'read'>`で、入力・保存を呼ぶ権限を持ちません。年だけ不明な表示は`confirmYear`がfalseなので失敗します。Excel解析・planの業務照合・集計検算・退避は行わず、読めた値がExcelと正しいかも判定しません。コンソールに表示された確認日の値を利用者が実画面と比べるための診断です。

新しい専用Edgeを起動するため、既存の同ポートEdgeは事前に閉じる必要があります。全月・全6項目を読めても入力や保存の動作確認は完了しません。自動テストは架空HTMLに対する回帰検証であり、このモードは実DOMを確認する手段です。

## 機能別マップ

### Excel読取・解析

`index.ts` → `discover`/`Prompt.choose` → `periodFromFilename` → `readWorkbook` → `parseWorkbook` → `AttendanceRecord[]` → `buildPlan`という流れです。

- `SheetJsReader.read`はファイルbufferを`XLSX.read`に渡し、`cellFormula: true`, `cellDates: false`で数式と数値日付を保持します。`.xls`/`.xlsx`に対応し、`readWorkbook`のReader引数から読取境界を差し替えられます。テンプレート判定はReaderではなくparserです。
- `parseWorkbook`は全シートのB8:M8の分割見出しを照合し、一致するシートが1枚だけであることを要求します。シート名自体は固定しません。現在のレイアウトはこの1種類で、未知の配置を推測しません。
- 10〜40行を日1〜31として解析。B列の日番号とC列のExcelシリアル日付をファイル名年月と全件照合します。1904日付方式は`Workbook.WBProps.date1904`を渡して解釈。月末を超える行はB:Mすべて空欄でなければ停止します。
- D/E=開始、F/G=終了、H/I=総時間、J/K=休憩、L/M=実働を整数の時・分として読みます。D:Mがすべて空欄なら`hasWork: false`。一部だけ値がある行は勤務として全組を検証し、欠落や文字列を拒否します。作業内容や休暇記述は解析しません。
- 開始は00:00〜23:59、終了・日別時間組は最大47:59。終了>開始、差分=総時間、総時間−休憩=実働>0を要求。日跨ぎは25:30のように24時以上を明記する方式だけで、翌日補完はありません。
- セルの`v`を使い、数式を再計算しません。使用セルの数式エラー、数式があるのに保存済み結果がない場合は停止します。L42/M42の合計実働と明細実働分合計を誤差0.001分未満で照合します。月合計の休憩欄は読みません。

`AttendanceRecord`はISO日付・日番号・勤務有無と、勤務日の開始/終了文字列・休憩/実働の小数時間を持ちます。Excelの文字列セルやWorkbookをブラウザ層へ持ち込みません。関連テスト: `tests/excel.test.ts`。保存済み数式結果欠落や1904方式などは実装に検査がありますが、それぞれの専用テストはありません。

### 設定読込

`index.ts`/`checkScreen.ts` → `loadSettings('config/settings.json')` → Zodの`settingsSchema` → `Settings`。勤務コードは数字の文字列として先頭ゼロを保持し、出社事由だけnullを許可します。拡張子は`.xls`/`.xlsx`、ポートは1024〜65535の整数。日時書式は`timestamp`を呼んで検証します。

セレクタJSONは入口が`readFile`/`JSON.parse`し、通常・再確認は`selectorsForRun`、画面確認は`inspectionSelectorsSchema`で検証します。読取用schemaも入力方式・保存確認方式などの構造検査を共有しており、「読取項目だけあれば設定を受理する」実装ではありません。詳細は「設定マップ」。

### Edge起動・CDP

`launchEdge`は設定されたパス、または標準のProgram Files (x86)・Program Files・LOCALAPPDATAのEdgeを探索します。localhostポートを一度listenして利用可能性を確認し、専用プロファイルを作成、独立プロセスを`spawn`/`unref`します。通常起動は表示付きの`about:blank`で、ログインやサイトへの画面移動はユーザー操作です。実運用起動に`--no-sandbox`はありません。

`connectEdge`は`chromium.connectOverCDP('http://127.0.0.1:ポート')`、通常timeoutは15秒、再確認の既存接続試行は2秒です。`disconnect`の`browser.close()`はこのCDP接続を解除し、独立Edgeを閉じません。`tests/cdp.test.ts`が切断後の再接続・ページ保持を検証します。`launchEdge`のパス探索・ポート拒否自体の直接テストはありません。

### 奉行画面探索

`findAttendancePage`はbrowserの全context・全tabに`AttendancePage`を作り、normalは`matches`、verifyDraftは`matchesSavedReturn`を使います。候補0件と複数件で停止し、先頭タブを推測で選びません。ログにはタブ番号・iframe数・タイトル総数/表示数・保存ボタン数・日付行数だけを出し、URLや氏名を出しません。

`matches`は一意で表示中の「勤務実績申請」タイトルと保存ボタン1件を確認します。ここだけでは年月や全日付は保証されず、後続の`assertPeriod`が検証します。`matchesSavedReturn`は同タイトル、申請期間目印と一覧入口各1件、保存ボタン・日付行がDOMに0件であることを要求します。iframeが指定されれば`root`は`FrameLocator`、nullならpageです。関連テスト: `tests/browser.test.ts`, `tests/draftReopen.test.ts`。

### セレクタ

| 構成要素 | 担当すること | 担当しないこと |
| --- | --- | --- |
| `config/selectors.json` | 実DOMのCSS/textセレクタ、読取方式、編集/確定方式、年月の証拠、保存確認方式、待機設定 | 業務期待値、勤務コード、コード実行 |
| `src/browser/selectors.ts` | 設定schema・型・組合せ検証・モードに応じたverified制御 | JSONファイルの読込、DOM探索・クリック |
| `src/browser/interactions.ts` | 一意で表示中の要素の確認、再読取待機、申請禁止等のクリックガード | 対象月の下書き選択、勤怠一致判定 |
| `src/browser/attendancePage.ts` | セレクタを日付行・編集scopeに適用し、読取/入力/保存/再照合を実行 | Excel解析・退避、ユーザーの出社/有休指定 |
| `src/browser/draftListPage.ts` | 一覧→対象行→詳細→申請書入力を安全に辿る | 日別勤怠値の入力や照合、下書き保存 |
| `src/browser/findAttendancePage.ts` | モードに合う対象タブの選択と件数診断 | ログイン、年月検証、値入力 |
| `src/browser/edgeLauncher.ts` | Edge実行ファイル・プロファイル・CDPの管理 | 奉行固有DOMの操作 |

`selectors.ts`は年月取得元、ダイアログ3設定の整合、customの`{code}`付きoptionとclear、activate/commitの対、commitFieldの一致、splitTime/splitDecimalの必要要素と項目適合、attribute読取の属性名、保存方式の必要設定を検証します。非表示テンプレート除外や重複の扱いはschemaではなく各Page Objectの処理です。

### 勤務実績読取

`AttendancePage.row`は年月を含む`PlannedDay.record.date`から月/日表示の正規表現で行を絞り、`unique`で一意性・表示を確認します。行番号・重複し得る行IDには依存しません。設定に`dateEvidence`があれば属性の年月日も一致が必要です。

`read`は6項目（`pattern`, `reason`, `start`, `end`, `break`, `worked`）をtext・現在のinputValue・属性のいずれかで読み、`normalized`で整えます。コードは数字部分、時刻は最大47:59のHH:mm、小数時間は2桁です。`emptyAttributes`がある事由セルでは各追加属性が空文字であることを要求し、欠落や複数事由を拒否します。

本番はセル本文を読みます。コード欄が開いている場合は、自動操作が開く直前のコードを`openedCodeValues`に記録したものだけ読めます。記録なし、入力値変更、時刻/休憩の未確定編集は停止条件です。古い`data-code`やHTMLのvalue属性を現在値とみなしません。関連テスト: `tests/dynamicCells.test.ts`, `tests/screenInspection.test.ts`。

### 競合判定

`buildPlan`はExcel勤務日と明示有休日だけを対象にします。出社日は勤務実績がある日、有休は勤務実績がない日でなければならず、両指定の重複も拒否します。通常勤務は在宅、出社指定はoffice、有休指定はpaid。非勤務日で有休未指定はplanに入らず、画面値の読取・競合判定・変更対象にもなりません（年月確認では全日付を検査）。

`enterAndSave`が全planの現在値をsnapshotへ取り、`conflicts`の差異を集め、競合が1件でもあれば最初の入力前に止めます。比較規則は次のとおりです。

| 現在値の状態 | 判定 |
| --- | --- |
| 期待値と全項目一致 | `equals`で一致、`ALREADY OK`として入力省略。保存前検証と下書き保存は行う |
| 項目が空欄、または期待値と同値 | 入力可能 |
| 勤務体系だけ異なる | 変更を許可（勤務体系は競合判定対象から除外） |
| 明示出社日の事由に旧在宅コードが残る | 出社用コード/null由来の空欄へ変更可能 |
| 出退勤が両方空欄で休憩/実働が0.00 | 未入力のゼロとして変更可能 |
| その他の異なる非空欄の時刻・事由・時間 | 競合として停止 |

有休の期待時刻・時間は空欄で、`equals`では休憩/実働の0.00も空欄と同等に扱います。入力直前にも`read`し、snapshotとの`JSON.stringify`比較で確認後の変更を拒否します。後の行で変更を発見した場合、先に入力した行は戻しません。関連テスト: `tests/domain.test.ts`, `tests/service.test.ts`, `tests/browser.test.ts`。

### 自動入力

`enterAndSave` → `AttendancePage.write`。通常勤務は体系・事由・開始・終了・休憩、有休は体系・事由だけを入力します。実働は画面側の計算結果を読み、直接書き込みません。有休の時刻を強制消去する処理もありません。

`write`はverifyDraftまたはverified=falseを最初に拒否します。必要なら行編集ダイアログを開き、`activate`でセルを編集、`fill`/`selectOption`/custom選択/分割入力を行い、`commit`クリックと入力欄非表示確認、または`blur`で確定します。ダイアログ方式なら`applyButton`で確定して閉じるまで待ちます。React等の画面更新も、Playwrightの通常入力とクリック・blurを通じて成立させます。内部API・イベントハンドラの直接呼出しはありません。

`timeParts('25:30')`は翌日区分2、時01、分30。`decimalParts('1.50')`は整数1、小数50であり、60進の30分に変換しません。`commitField`先のコード欄を開く直前にも`trackCodeEditor`で元表示を記録し、コード自体は変更せず後のreadで監視します。関連テスト: `tests/browser.test.ts`, `tests/dynamicCells.test.ts`。

### 入力後検証

入力と検証は別メソッドです。`write`は操作、`verify`は`read`の6項目と`day.expected`を`equals`で照合します。値の不一致は100ms間隔で`timeoutMs`まで再読取しますが、読取自体の不正状態は例外となります。再入力による修正はしません。

serviceは変更した各行の直後にverifyし、全行処理後に年月を再確認して、ALREADY OKを含む全対象日をもう一度verifyします。通常勤務日数とExcel勤務日数、読取実働/休憩合計とExcelの各合計（差0.02時間未満）を検算し、有休件数を記録します。対象日の期待値照合が有休の体系/事由・時間空欄/ゼロも保証します。月全体の画面集計や未指定有休件数との比較ではありません。成功後に`state.verified=true`。関連テスト: `tests/service.test.ts`, `tests/browser.test.ts`。

### 下書き保存

`enterAndSave`の保存前全対象日検証・集計成功後、`AttendancePage.saveDraft`を1回呼びます。Page Object側もモードとverifiedを検査し、`draftButton`でrole=button・完全一致の「下書き保存」を使います。保存前の業務検算はserviceの責務で、Page Objectだけを直接呼べばRunStateを検査するわけではありません。

| saveMode | 保存前確認と成功条件 | 利用状況 |
| --- | --- | --- |
| `reopenDraft` | period/非空plan、保存後目印が未表示 → 1回クリック → 遷移 → 対象下書き再表示 → 年月/全対象日一致 | 現在の本番設定。件数増加は要求しない |
| `countAndReturn` | 保存前件数を取得、目印未表示 → 1回クリック → 目印表示・保存ボタン/日付行の消失・件数がちょうど+1 | 互換実装。件数不変の更新は未確認扱い。保存内容自体の再照合なし |
| `message`（省略時もこの経路） | 古い成功文言が残っていない → 1回クリック → 一意な成功表示が指定文言と一致 | 互換実装・模擬画面。保存内容自体の再照合なし |

したがって「保存後に必ず再オープン」は現在の本番設定の保証です。別saveModeへ変更すると保存確認の意味が変わります。verify-draftはreopenDraft方式専用です。

保存クリック・一覧リンク・申請書入力は自動で再クリックしません。待機で繰り返すのは読取だけです。通信断等で保存済みか不明になった場合は`saved=false`のまま、Excelを保持します。利用者が画面を確認し、必要ならverify-draftで既存下書きを照合します。最終申請操作は実装せず、再保存・削除も復旧処理に含めません。関連テスト: `tests/browser.test.ts`, `tests/draftReopen.test.ts`。

### 下書き再オープン

`AttendancePage.reopenDraft`は申請期間の目印を一意な表示まで待ち、保存ボタン非表示・日付行DOM消失を確認し、`DraftListPage.openMonth`へ進みます。`DraftListPage.ready`は要素の一意性・可視性、busy非表示、stableMsの継続を待ちます。

一覧は「申請状況」タイトルと読込完了表示を確認。各行から状態・申請名・期間を一意に読み、「下書き」「勤務実績申請」、`isWholeMonthRange`で対象年/月の1日〜末日が一致する候補を1件だけ選びます。別月・承認待ち・部分期間・重複は開きません。前の詳細の入力ボタンが残っている状態も拒否し、該当行のリンク→新たに表示された「申請書入力」非送信ボタンの順に操作します。

`safeClick`は通常「申請」を含むラベルを拒否しますが、この再表示には専用の`draftList`/`draftDetails`/`draftEditor`操作を用意しています。各ラベル完全一致と要素種別を確認し、一覧入口のtype未指定buttonはフォーム所有なしの場合だけ許可。詳細リンクはhref空文字/#・target未指定/_self、申請書入力はtype=buttonだけです。これは最終申請の許可ではありません。

同じpageまたは設定したiframe内の遷移を想定し、別タブ・複数階層iframe・仮想スクロールへの自動適応はありません。関連テスト: `tests/draftReopen.test.ts`。

### 保存後再検証

`verifyOpenedDraft`は`openedCodeValues`をクリアし、busy非表示、一意な入力画面タイトル、保存ボタン表示、日付行と全6読取要素の準備を待ちます。本番rowDatesでは行数が月日数と一致することも条件です。一時的なタイトル重複や遅延は読取待機で解消を待ちます。

準備後は`assertPeriod(period, async () => false)`と全planのverifyを実施します。保存後に年不明を手動承認して通す経路はありません。年月は全月、値は勤務日＋明示有休日だけが照合対象で、非対象日の値は照合しません。ここで再入力・再保存はしません。

通常は`saveDraft`がこの処理まで成功して戻るとserviceが`state.saved=true`にします。verify-draftは共通の`reopenDraft`を使い、`verifySavedDraft`が成功時だけverified/savedの両方をtrueにします。関連テスト: `tests/draftReopen.test.ts`。

### Excelバックアップ

`index.ts`は画面処理成功後、CDP切断が完了してから`backupFile`を呼びます。`input/`と`filesback/`の場所はsettingsで変更可能です。`fingerprint`は選択直後、解析直後、退避直前に同じ内容であることを確認します。

`backupFile`の条件はsavedかつverified、sourceがinput直下でシンボリックリンクでないこと、選択時SHA-256と同値であることです。退避先ルートを作成後、日本時間timestampのディレクトリを`mkdir`（recursiveなし）で排他的に作り、元名を保って`rename`します。既定は `filesback/YYYYMMDDHHMMSS/元ファイル名`。copyではなくmoveで、成功後にinputから消え、`state.backedUp=true`となります。

同秒ディレクトリが存在すると中身にかかわらず停止し、上書き・suffix付与・再試行はありません。rename失敗では空の退避ディレクトリが残る場合があります。別ドライブへのrenameなどの失敗にcopy+deleteで代替する処理もありません。バックアップのみ失敗は`index.ts`が警告と終了コード2にし、保存結果を戻さず手動退避を案内します。画面側の失敗ではここへ到達せず終了コード1です。関連テスト: `tests/service.test.ts`, `tests/domain.test.ts`, `tests/files.test.ts`。

### ログ

通常/verify-draftは`createLogger('logs')`を使います。保存先は設定ではなく`index.ts`に固定。ファイル名はUTCのISO日時（コロン/ピリオドをハイフンへ置換）＋PID、各行の時刻も`toISOString()`のUTCです。バックアップの日本時間timestampとは別です。

記録するものは選択パス、サマリー、日別SKIP/ALREADY OK/OK、競合の現在値/期待値、画面識別件数、検算・保存・退避結果、段階と状態付きのアプリケーションエラー。勤務日時とファイル名が含まれるため匿名ログではありません。個人名を含むファイル名ならその文字列も残ります。

`index.ts`は`UserError`だけメッセージを出し、その他の例外は固定の案内へ置換します。画面探索も失敗時に固定メッセージを使い、URL・HTML・Cookie・認証情報・生のブラウザエラー/stackを記録しません。`createLogger`自体に汎用の個人情報マスク機能はなく、呼び出し元が渡す内容で境界を守ります。Promptの入力やretryメッセージはconsole出力であり、このloggerを経由しません。

check-screenはconsoleのみでloggerを作らず、勤務値のログファイルを残しません。ログの直接テストはありません。新しい診断を追加するときはURLやDOM全体を出さず、アプリ生成メッセージだけを渡す既存方針を確認してください。

### 実行ロック

`index.ts`と`checkScreen.ts`は同じ`.runtime/run.lock`を`open(..., 'wx')`で排他的に作り、PID文字列を書きます。通常/再確認はモード判定直後、画面確認は設定検証後に取得します。存在すればPIDの生存判定をせず停止します。

所有フラグがある場合、通常終了・キャンセル・catchされる例外ともfinallyでunlinkします。強制終了・プロセス異常停止・削除失敗では残るため、他の処理が動いていないことを確認してrun.lockだけを手動削除します。`index.ts`はPID書込・close完了後にlockedをtrueにするので、取得後の書込/close失敗でも残り得ます。checkScreen側は取得直後に所有フラグを立てます。自動回収や共通lock utilityはありません。

`.runtime/edge-profile`は専用Edgeの認証状態を含み得ます。ロック解放時にプロファイルやEdgeを消す処理はありません。`.gitignore`が`.runtime/`、input/filesback/logsの実データを除外し、各データディレクトリの`.gitkeep`だけを保持します。ロック生命周期の直接テストはありません。

### 日付・時刻

| `src/utils/date.ts`の関数 | 用途・呼び出し元 |
| --- | --- |
| `periodFromFilename` | `index.ts`が`YYYYMM_名称`から対象年月を取得、年1900以上・月1〜12を検証。拡張子制限はdiscover/Reader |
| `daysInMonth` | UTC計算で月日数を得る。parser、日指定、画面全日付検証、下書き期間、画面確認で共有 |
| `isoDate`, `pad` | parserのdomain日付/時刻、画面確認のread対象日を生成 |
| `parseDays` | 出社・有休日のカンマ/読点入力、範囲検証、重複排除・昇順化 |
| `parseScreenPeriod` | display方式の西暦・令和・平成（元年含む）・月のみを厳密に読む。周辺文言や曖昧な年月を拒否 |
| `isWholeMonthRange` | 下書き一覧期間に含まれる年付き日付2つが対象月1日/末日であるか判定 |
| `timestamp` | `loadSettings`の形式検証と`backupFile`のディレクトリ名生成。`Intl.DateTimeFormat`のAsia/Tokyoを使用 |

Excelシリアルの変換はparser内のSheetJS、奉行の日付属性の正規表現照合はAttendancePageです。日跨ぎの最大47:59はparser/normalize、翌日区分の入力変換はsplitInputで担当し、Dateによる翌日推測ではありません。関連テスト: `tests/domain.test.ts`, `tests/excel.test.ts`, `tests/dynamicCells.test.ts`, `tests/draftReopen.test.ts`。

### CLI

`Prompt`はreadline/promisesの入出力だけを担当。`choose`は1件自動選択・複数件番号入力、`retry`は`UserError`だけを表示して再質問し、その他の例外を上へ戻します。`confirm`はy/yes/n/noを受理し、大文字小文字・前後空白を整え、不正応答は再質問します。実行前はdefaultYes=true（Enterで開始）、年の追加確認はdefaultYes=false（Enterで拒否）。手動ログイン後の待機はquestionによるEnterです。

質問順序・業務検証・モード分岐・エラー状態表示は`index.ts`/`checkScreen.ts`の責務です。`summary`はplanの対象勤務日だけの実働/休憩合計と出社/有休を表示。`leaveWarning`は有休未指定時に設定コードで手動入力を案内し、indexは処理後/途中入力後にも必要なら再表示します。batのpauseはCLI終了後の表示保持です。`tests/files.test.ts`が警告文のコード反映を検証しますが、Promptの対話全体やbat起動の自動テストは現在ありません。

## 設定マップ

### config/settings.json → Settings → 利用箇所

| キー | 現在値 | 主な利用先・影響 |
| --- | --- | --- |
| `attendance.workPatternCode` | `"205"` | buildPlanが勤務/指定有休日のexpected.patternへ → write/read照合、summary |
| `attendance.remoteReasonCode` | `"007"` | 在宅expected.reasonと、conflictsで出社日の旧在宅事由変更を許す基準 |
| `attendance.officeReasonCode` | `null` | 出社expected.reasonを空欄へ。数字コードに変えればその値を入力 |
| `attendance.paidLeaveReasonCode` | `"040"` | 明示有休のexpected.reason、未指定時のleaveWarning |
| `files.inputDirectory` | `"input"` | discoverの検索先とbackupFileのsource直下検査 |
| `files.backupDirectory` | `"filesback"` | backupFileの移動先ルート |
| `files.supportedExtensions` | `[".xls", ".xlsx"]` | discoverで候補を絞る。新形式追加はschema/Reader側の対応も必要 |
| `files.backupTimestampFormat` | `"yyyyMMddHHmmss"` | loadSettingsで検証し、backupFileで利用。対応トークンyyyy/MM/dd/HH/mm/ssと区切り-/_ |
| `browser.remoteDebuggingPort` | `9222` | launchEdgeの空き確認/起動引数、connectEdgeのlocalhost接続 |
| `browser.userDataDirectory` | `".runtime/edge-profile"` | launchEdgeが専用プロファイルを作成・指定 |
| `browser.executablePath` | `null` | launchEdgeが標準パスを探索。指定時はそのパスだけを試す |
| `browser.selectorsFile` | `"config/selectors.json"` | 各入口が読むセレクタJSONのパス |

check-screenも同じSettings全体を検証しますが、勤怠コードやExcel設定を処理には使いません。logsとrun.lockのパスはsettingsにはなく入口に固定されています。

### config/selectors.json → InspectionSelectors / Selectors → 利用箇所

| キー/設定群 | 現在の方式 | 利用箇所・変更時の注意 |
| --- | --- | --- |
| `verified` | true | 通常用selectorsSchemaはtrue必須。verifyDraft/checkScreenはメモリでfalse、write/saveDraftが拒否。自動昇格なし |
| `frame` | null | AttendancePage.rootとDraftListPageの探索scope。単一frame指定に対応 |
| `title` | `text="勤務実績申請"` | matches/pageTitle/識別件数。非表示タイトルは除外 |
| `periodSource`, `period`, `dateEvidence` | rowDates、period=null、inputのdata-labordate | assertPeriodが全日付の年月を検証、rowが個別日の表示と属性を照合。displayなら専用年月要素が必要 |
| `rows`, `dateCell` | 日付inputを持つ親trと日付td | row探索と全日付照合。集計行・内側左右表・重複IDを避ける |
| `editor`, `editButton`, `applyButton` | すべてnull | writeの任意ダイアログ方式。設定するなら3つとも必要 |
| `fields.*.read`, `readMode`, `readAttribute` | 6項目ともセルtext | read/verify。属性方式ならreadAttribute必須。workedは読取だけ |
| `fields.reason.emptyAttributes` | data-code2〜data-code5 | 複数事由や属性不明状態をreadで拒否 |
| `fields.*.input`, `control` | pattern/reasonはfill、start/endはsplitTime、breakはsplitDecimal | writeの入力方式。select/customも実装。workedの入力定義はない |
| `fields.*.activate`, `commit`, `commitField` | セルで開き、他のコードセルで確定 | write/trackCodeEditor。勤務体系→事由、それ以外→勤務体系。schemaが確定先の整合を検査 |
| `fields.*.dayType`, `hour`, `minute` | 時刻・休憩の入力コンテナ内 | splitInputの変換結果をfill。minuteは休憩では小数部を意味する |
| customの`option`, `clear` | 本番未使用 | writeでコード置換optionを選択、空文字ならclear。実DOMを確認して設定 |
| `saveMode` | reopenDraft | saveDraftの成功確認経路を選ぶ。変更すると再照合の保証が変わる |
| `returnMarker` | `text="申請期間"` | saveAndReopen/reopenDraft/matchesSavedReturnの保存後画面確認 |
| `draftList.entry/title/loaded/rows` | 下書き件数・申請状況・読込完了・一覧親行 | DraftListPageの入口/準備/行探索 |
| `draftList.status/name/period/open` | 一覧の各行内 | 下書き・勤務実績申請・全月期間を特定、詳細リンクを開く |
| `draftList.openEditor` | 申請書入力のtype=button | 詳細から入力画面を開く。最終申請ボタンとは別 |
| `draftCount` | 下書き:N件 | 現在reopenDraftの保存判定には使わない。countAndReturnのreadDraftCount用（一覧入口はdraftList.entry） |
| `saveSuccess`, `saveSuccessText` | null | message方式の保存完了検出用。本番未使用 |
| `timeoutMs` | 10000 | 通常のPlaywright操作・日別verify・互換保存方式の待機 |
| `transitionTimeoutMs` | 60000 | 再表示の目印/一覧各段階/入力画面準備の待機。省略時timeoutMs。処理全体の60秒上限ではない |
| `busy` | `.js-cm-progressBase` | DraftListPage.readyとverifyOpenedDraftが全画面読込中の操作/照合を抑制 |
| `transitionStableMs` | 1000 | DraftListPage.readyで一意・表示・busyなしが続く時間。全クリック共通の固定sleepではない |

詳細なDOM確認手順・探索scopeは [selectors.md](selectors.md)。模擬画面専用の`tests/fixtures/selectors.json`を本番へコピーしないでください。

## テストマップ

`package.json`の`check`は`tsc --noEmit`、`test`は`tsx --test tests/*.test.ts`です。`tsconfig.json`はsrc/testsをstrict・NodeNext・noEmitで検査します。独自テストframeworkではなくNodeの`node:test`/assertを使用します。

| テストファイル | 件数 | 対応実装・保証内容 | 主な保証外 |
| --- | --- | --- | --- |
| `tests/excel.test.ts` | 4 | reader/parser。架空明細正規化・非勤務日の保持、生成したxls/xlsxバイナリ読取、未対応拡張子拒否、年月/時分/欠落/ヘッダー/合計/数式エラー拒否、28/29/30/31日 | 実原本、数式再計算、1904方式・キャッシュ欠落・日跨ぎparserの専用ケース |
| `tests/domain.test.ts` | 6 | date/validationService。命名年月、日指定と閏日、画面和暦/西暦/月のみ、在宅/出社/有休/非対象plan、競合許可と拒否、正規化、日本時間timestamp | 設定読込I/O、画面/ファイル副作用 |
| `tests/service.test.ts` | 5 | attendanceService/backupService。fake portで全件事前競合、各失敗段階の保存抑止、一致時入力省略・保存1回、書込直前の変更検知、保存/検証後のみ移動・timestamp衝突・hash変更時保持 | 実DOM、indexの対話・終了コード、ロック、別ドライブrename |
| `tests/browser.test.ts` | 14 | AttendancePage/findAttendancePage/selectors/interactions。日付行の非順序入力、在宅/出社/有休・非対象保持、再実行、年月/競合/重複/計算不一致拒否、申請禁止、message方式の古い/欠落成功表示、確認済み設定、非表示タイトル除外・候補タブ重複、編集ダイアログ、countAndReturn成功/件数不変/異常増加/遷移失敗/全ページ遷移と再クリックなし | 本番DOM・認証、reopenDraftの詳細経路 |
| `tests/dynamicCells.test.ts` | 10 | AttendancePage/splitInputと本番設定由来の入力方式。左右表/重複ID/非日付行、分割セルの確定、小数部50、古いdata-codeと現在inputValue、年月属性、複数事由、未確定編集、確定失敗、翌日区分、全日付属性の不足/矛盾、自動/手動で開いたコード欄の扱い | React本体・実奉行、翌日時刻の実画面非編集表示 |
| `tests/draftReopen.test.ts` | 17 | AttendancePage/DraftListPage/attendanceService/date/selectors/executionMode。新規/更新の保存値再読取、古い値拒否、busy・安定待機・一時タイトル重複・遅い明細・隠しtemplate・期限停止、verifyDraftの入力/保存禁止と成功フラグ、一覧/詳細ガード、重複/別月/承認待ち/部分期間拒否、遷移/詳細失敗・重複入力ボタン・再表示月違い、全月期間、引数とverified | 実サイト、既存CDP接続の起動分岐、indexによる実Excel退避までの一体実行 |
| `tests/screenInspection.test.ts` | 3 | inspectScreen/AttendancePage/selectors。verified=falseの読取と書込/保存拒否、全29日6項目/確認日の返却、DOM不変・click/input/changeゼロ、日付欠落/重複/別年/項目欠落拒否 | 実DOMの値と人の目による一致、checkScreen全対話 |
| `tests/cdp.test.ts` | 1 | connectEdge/disconnect。一時プロファイルの独立headless Edgeへ接続し、切断後もCDPとページを保持して再接続 | 本番launchEdge・手動ログイン・ポート衝突 |
| `tests/files.test.ts` | 2 | discover/leaveWarning。命名・拡張子・複数候補・Excel一時ファイル/ディレクトリ除外、設定有休コードと手動入力案内 | Prompt選択・ログ・実行ロック（このテストの「ロックファイル」はExcelの`~$`一時ファイル） |

計62件。`tests/helpers.ts`は架空の`record`/`workbook`・コード・期間を生成する共通ヘルパーです。`tests/fixtures/attendance.html`は並び替え日付・画面計算・保存/申請カウンタ、`tests/fixtures/draftReopen.html`は保存値と一覧/詳細/再表示・遅延/失敗を模擬します。実サイトから保存したHTMLや原本ではありません。`tests/fixtures/selectors.json`は前者の読取/入力/保存表示用設定です。dynamicCellsとscreenInspectionはテスト内で独自の架空HTMLを生成します。

ブラウザ系4ファイル（browser/draftReopen/dynamicCells/screenInspection）は`chromium.launch({ channel: 'msedge', headless: true })`で標準Edgeを使います。CDPテストだけは既定Edgeパスを`EDGE_PATH`で変更可能で、使い捨てプロファイルと空きポートを使い、テスト自身のEdgeを終了します。実運用の9222・ログイン状態・勤怠画面には接続しません。CDPテストには`--no-sandbox`等の環境向けフラグがありますが、本番起動とは別です。

| 変更の種類 | 実施する確認 |
| --- | --- |
| ドキュメントだけ | パス/識別子/呼び出し関係・設定値を照合、git差分でコード未変更を確認。check/testは任意 |
| 型・設定schema・実装TS | `npm run check`でsrcとtestsの型整合、その後`npm test`で関連機能と安全境界を回帰確認 |
| Excel・判定・退避・日付 | check＋test。先にexcel/domain/service/filesの該当ケースを見る |
| DOM・入力・保存・モード | check＋test。browser/dynamicCells/draftReopen/screenInspection/cdpの該当ケースを確認。実画面の読取や入力/保存は別途の確認範囲 |
| バッチ・CLI・ロック・ログ・Edge起動条件 | check＋testに加え、直接テストがない入口/失敗経路を確認。全件成功だけで対話や本番起動を検証済みとしない |

2026-10-04の本文作成時はnpmがPATHに存在しなかったため、既存インストールから次の同等コマンドを実行しました。型検査は終了コード0、自動テストは62件成功・失敗/skipとも0です。実奉行への操作は行っていません。

```text
node node_modules/typescript/bin/tsc --noEmit
node node_modules/tsx/dist/cli.mjs --test tests/*.test.ts
```

## データ / 制御フロー

```text
config/settings.json → Settings.attendance（コード）──────────┐
inputの選択ファイル → SHA-256（変化検知）                    │
  └→ ファイル名 → Period                                   │
     ExcelReader → XLSX.WorkBook → parseWorkbook             │
       → AttendanceRecord[] ＋ 出社/有休日 → buildPlan ←─────┘
          → PlannedDay[]（record / kind / expected: Fields）
             ├→ summary
             ├→ 現在Fields：AttendancePage.read → conflicts / equals
             ├→ write → verify → 集計検算
             └→ 保存済みFields：reopenDraft → verifyOpenedDraft → verify

config/selectors.json → schema / verified制御 → AttendancePage / DraftListPage
Settings.browser → launchEdge / connectEdge → findAttendancePage → Page Object
RunStateのverified && saved → backupFile ＋ 元hash ＋ Settings.files → rename
各段階/結果 → logger（通常/再確認）またはconsole（画面確認）
```

| RunStateのフィールド | 意味と設定箇所 |
| --- | --- |
| `stage` | 入口/serviceが現在段階を更新、indexのエラー表示に使う |
| `inputStarted` | enterAndSaveが最初のwrite呼出し前にtrue。失敗時は部分入力の可能性を示す |
| `verified` | 通常は保存前全対象日・集計成功後true。再確認は既存下書き全対象日一致後true |
| `saveAttempted` | 通常serviceがsaveDraft呼出し前にtrue。内部事前条件で止まる場合もtrueなので、クリック到達の厳密な証明ではない |
| `saved` | saveDraftの設定方式に応じた成功確認後true。再確認では保存済み値の照合成功を表す |
| `backedUp` | backupFileがrename成功後true |

通常の保存後照合が失敗したとき、保存前verifiedがtrueのままでもsavedはfalseです。退避は両方が必要です。再確認は照合の冒頭で両方をfalseに戻します。終了コードはindex/checkScreenの`process.exitCode`からbatが保持します。画面確認は成功0/例外1、通常/再確認は成功0/退避だけ失敗2/その他例外1です。

## 安全上の重要な境界

- ログインID・パスワード入力、MFA、ログイン後の対象画面への移動は手動です。ログイン自動化コードはありません。
- 最終「申請」を押すメソッド・セレクタはありません。クリックはsafeClick経由で、通常の申請ラベルを拒否。下書き再表示の専用例外は名称/種別を限定し、申請・削除・フォーム送信を許可しません。
- 未知Excelレイアウト・数式エラー/結果欠落・年月違い・不正時間/合計を拒否し、勤務空欄から有休や休日候補を推測しません。
- 対象月を確定できない状態で入力しません。本番は全日付属性と表示を照合。display方式の月のみ表示は通常に限り利用者の年追加確認が可能で、保存後/画面確認は年不明を拒否します。
- 入力前に全対象日の競合を確認し、許可した体系変更・明示出社日の旧在宅事由等を除く競合を強制上書きしません。各行の直前にも画面変化を検出します。
- 入力後の行照合と保存前全対象日検証・集計検算を行います。本番reopenDraftは保存後に再度開いて同じ期待値へ照合します。互換のmessage/countAndReturnに変更すると保存後値照合はありません。
- 保存は1回だけで、成功不明でも再保存しません。確認できなければExcelを保持し、自動ロールバックもしません。保存内容の確認とファイル移動は別操作で、単一transactionではありません。
- verify-draftは入力・保存・申請・削除を行わず、下書き再表示のクリックと照合成功後のExcel移動だけです。check-screenは画面読取専用で、クリック・Excel操作・ログ作成・設定変更を行いません。どちらもロックや専用プロファイルを使います。
- 正常終了・異常終了でも専用Edgeを自動終了しません。認証情報を持ち得るプロファイルと勤務日時を含むログは共有・コミットの対象にしません。

### 既存資料との照合と現在の未対応範囲

`README.md`と`はじめに_使い方.md`の主要な通常/再確認/画面確認フローは現在のコードと一致します。現在の切替経緯は`docs/verification.md`末尾と`docs/selectors.md`に記載されています。

既存資料の「Excelコピーの退避」はinputに配置したコピーを指す文脈があります。実装の退避操作は一貫してrenameによる移動であり、inputにファイルを残すcopy機能はありません。READMEの移動説明とも一致します。

本番未対応/未確認の境界は、別タブへ開く下書き、複数階層iframe、DOMに全日付が存在しない仮想スクロール、未知のExcel配置・翌日推測、未知の翌日時刻表示、特休の自動判定・入力です。splitInputは翌日入力を生成できますが、実奉行の非編集時表示を任意形式で解釈できるわけではありません。原本専用スクリプトや開発時の未確認設定での通しテスト入口は現在のファイル一覧に存在しません。

## 変更内容から調査先を引く逆引き表

| やりたいこと・症状 | 最初に見るファイル | 一緒に確認するファイル | テスト |
| --- | --- | --- | --- |
| Excelレイアウトを追加したい | `src/excel/parser.ts` | `src/excel/reader.ts`, `src/domain/attendance.ts`, `tests/helpers.ts`, `docs/investigation.md` | `tests/excel.test.ts` |
| 新しいExcelファイル形式に対応したい | `src/excel/reader.ts` | `src/domain/config.ts`, `src/utils/file.ts`, `config/settings.json` | `tests/excel.test.ts`, `tests/files.test.ts` |
| inputのファイルが候補に出ない | `src/utils/file.ts` | `src/utils/date.ts`, `src/cli/prompt.ts`, `config/settings.json` | `tests/files.test.ts`, `tests/domain.test.ts` |
| 数式・月合計・日跨ぎで解析失敗 | `src/excel/parser.ts` | `src/excel/reader.ts`, `src/browser/splitInput.ts`, `src/services/validationService.ts` | `tests/excel.test.ts`, `tests/dynamicCells.test.ts` |
| 勤務体系/在宅/出社/有休コードを変えたい | `config/settings.json` | `src/domain/config.ts`, `src/services/validationService.ts`, `src/cli/summary.ts` | `tests/domain.test.ts`, `tests/files.test.ts`, `tests/browser.test.ts` |
| 出社/有休指定のルールを変えたい | `src/services/validationService.ts` | `src/utils/date.ts`, `src/index.ts`, `src/browser/attendancePage.ts` | `tests/domain.test.ts`, `tests/browser.test.ts` |
| ALREADY OKなのに入力/保存される | `src/services/attendanceService.ts` | `src/services/validationService.ts`, `src/browser/attendancePage.ts` | `tests/service.test.ts`, `tests/browser.test.ts`（一致でも保存は実行） |
| 競合判定や確認後の変更検知を変えたい | `src/services/validationService.ts` | `src/services/attendanceService.ts`, `src/browser/attendancePage.ts` | `tests/domain.test.ts`, `tests/service.test.ts`, `tests/dynamicCells.test.ts` |
| 奉行のDOM変更に対応したい | `config/selectors.json` | `src/browser/selectors.ts`, `src/browser/attendancePage.ts`, `src/browser/draftListPage.ts`, `docs/selectors.md` | `tests/browser.test.ts`, `tests/dynamicCells.test.ts`, `tests/draftReopen.test.ts` |
| 日付行が見つからない/年月が不一致 | `src/browser/attendancePage.ts`（row/assertPeriod） | `config/selectors.json`, `src/utils/date.ts` | `tests/dynamicCells.test.ts`, `tests/screenInspection.test.ts`, `tests/browser.test.ts` |
| 対象タブ0件/複数件・iframe問題 | `src/browser/findAttendancePage.ts` | `src/browser/attendancePage.ts`（matches/identificationCounts）, `config/selectors.json` | `tests/browser.test.ts`, `tests/draftReopen.test.ts` |
| 入力値が反映されない・編集が閉じない | `src/browser/attendancePage.ts`（write/trackCodeEditor） | `config/selectors.json`, `src/browser/splitInput.ts`, `src/browser/interactions.ts` | `tests/dynamicCells.test.ts`, `tests/browser.test.ts` |
| 休憩が1.50にならない/翌日入力が違う | `src/browser/splitInput.ts` | `src/browser/attendancePage.ts`, `src/services/validationService.ts`, `src/excel/parser.ts`, `config/selectors.json` | `tests/dynamicCells.test.ts`, `tests/excel.test.ts` |
| 入力後/集計検証が失敗する | `src/services/attendanceService.ts` | `src/browser/attendancePage.ts`（read/verify）, `src/services/validationService.ts` | `tests/service.test.ts`, `tests/browser.test.ts` |
| 下書き保存できない/保存成功が不明 | `src/browser/attendancePage.ts`（saveDraft） | `src/services/attendanceService.ts`, `src/browser/interactions.ts`, `config/selectors.json` | `tests/browser.test.ts`, `tests/draftReopen.test.ts` |
| 保存後の下書きが見つからない | `src/browser/draftListPage.ts` | `src/utils/date.ts`（isWholeMonthRange）, `config/selectors.json`, `src/browser/attendancePage.ts` | `tests/draftReopen.test.ts` |
| 一覧/詳細/入力画面の遷移が止まる | `src/browser/draftListPage.ts`（ready） | `src/browser/attendancePage.ts`（reopenDraft/verifyOpenedDraft）, `src/browser/interactions.ts`, `config/selectors.json` | `tests/draftReopen.test.ts` |
| 保存済み値がExcelと合わない | `src/browser/attendancePage.ts`（verifyOpenedDraft） | `src/services/validationService.ts`, `src/services/attendanceService.ts`, `src/index.ts`（日指定） | `tests/draftReopen.test.ts`, `tests/domain.test.ts` |
| バックアップされない/同秒衝突 | `src/services/backupService.ts` | `src/index.ts`, `src/services/attendanceService.ts`（RunState）, `src/utils/date.ts`, `config/settings.json` | `tests/service.test.ts`, `tests/domain.test.ts` |
| Edgeが起動しない/ポート使用中 | `src/browser/edgeLauncher.ts` | `config/settings.json`, `src/index.ts`, `src/checkScreen.ts` | `tests/cdp.test.ts`（起動パス/ポート検査は直接保証外） |
| 終了後Edgeを保持できない | `src/browser/edgeLauncher.ts`（disconnect） | `src/index.ts`, `src/checkScreen.ts` | `tests/cdp.test.ts` |
| verify-draftを変更したい | `src/index.ts`（verifyDraft分岐） | `src/domain/executionMode.ts`, `src/services/attendanceService.ts`, `src/browser/selectors.ts`, `src/browser/attendancePage.ts`, `verify-draft.bat` | `tests/draftReopen.test.ts` |
| check-screenを変更したい | `src/checkScreen.ts` | `src/services/screenInspection.ts`, `src/browser/selectors.ts`, `src/browser/attendancePage.ts`, `check-screen.bat` | `tests/screenInspection.test.ts` |
| 未確認設定/書込禁止が想定と違う | `src/browser/selectors.ts` | `config/selectors.json`, `src/browser/attendancePage.ts`（write/saveDraft）, `src/domain/executionMode.ts` | `tests/browser.test.ts`, `tests/draftReopen.test.ts`, `tests/screenInspection.test.ts` |
| 最終申請禁止を維持して画面操作を増やす | `src/browser/interactions.ts` | `src/browser/attendancePage.ts`, `src/browser/draftListPage.ts` | `tests/browser.test.ts`, `tests/draftReopen.test.ts` |
| ログ/個人情報/診断表示を変更したい | `src/utils/logger.ts` | `src/index.ts`, `src/browser/findAttendancePage.ts`, `src/checkScreen.ts` | `tests/browser.test.ts`（識別件数だけ部分検証）、ログ直接テストなし |
| ロックが残る/同時実行を変えたい | `src/index.ts` | `src/checkScreen.ts`, `.gitignore`, `src/browser/edgeLauncher.ts` | 専用テストなし。取得/解放/例外経路を確認 |
| 質問・確認・サマリー・有休案内を変えたい | `src/cli/prompt.ts`, `src/cli/summary.ts` | `src/index.ts`, `src/checkScreen.ts`, `src/utils/date.ts` | `tests/files.test.ts`, `tests/domain.test.ts`（Prompt直接テストなし） |
| bat起動/終了コード/Enter待機を変えたい | `run.bat`, `verify-draft.bat`, `check-screen.bat` | `src/index.ts`, `src/checkScreen.ts`, `package.json`, `tsconfig.json` | bat専用テストなし。入口・引数・戻り値を確認 |

既存資料の役割: [README.md](../README.md)は運用/設定/失敗対応、[はじめに_使い方.md](../はじめに_使い方.md)は毎月の操作、[investigation.md](investigation.md)は初期資料/セル配置、[selectors.md](selectors.md)はDOM設定/実画面確認、[verification.md](verification.md)は検証経緯です。現在の挙動を判断するときは本索引の実装パスを辿り、過去の検証段階と現在の設定を区別してください。
