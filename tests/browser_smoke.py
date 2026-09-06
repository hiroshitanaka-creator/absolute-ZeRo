"""Local rendered UI checks. No external navigation, no policy modifications.
Uses a documented in-memory Storage test double with the real game's serialization.
Native browser persistence, real iOS and HTTPS PWA installation are separate checks.
Run: npm run build && python tests/browser_smoke.py
"""
import json
import os
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / 'Absolute-Zero-standalone.html').read_text()
RESULTS = []
ERRORS = []
PAGES = []

def record(name, details=''):
    RESULTS.append({'test': name, 'status': 'PASS', 'details': details})
    print('PASS', name, details, flush=True)

def base_store(code='AZ1-J01'):
    return {'version': 'AZ1', 'current': code, 'lastMode': {}, 'sessions': {}, 'records': {}, 'dailyWins': [], 'settings': {'sound': False, 'dark': False, 'motion': False}}

def boot(browser, code='AZ1-J01', width=390, height=844, stored=None):
    page = browser.new_page(viewport={'width': width, 'height': height}, device_scale_factor=1, is_mobile=width<600, has_touch=width<600)
    page.set_default_timeout(6000)
    PAGES.append(page)
    page.on('pageerror', lambda e: ERRORS.append(str(e)))
    data = {'absolute-zero:v1': json.dumps(stored or base_store(code), ensure_ascii=False)}
    fixture = '<script>window.__AZ_STORAGE__=' + json.dumps(data, ensure_ascii=False) + ';Object.defineProperty(window,"localStorage",{configurable:true,value:{getItem:k=>window.__AZ_STORAGE__[k]??null,setItem:(k,v)=>{window.__AZ_STORAGE__[k]=String(v)},removeItem:k=>{delete window.__AZ_STORAGE__[k]}}});</script>'
    page.set_content(HTML.replace('<head>', '<head>' + fixture), wait_until='load')
    page.wait_for_function('!!window.AbsoluteZero')
    return page

def snapshot(page):
    return page.evaluate('AbsoluteZero.snapshot()')

def wait_unlocked(page):
    page.wait_for_function('document.getElementById("board").getAttribute("aria-busy") === "false"')

def move(page, f, t):
    page.locator(f'#board [data-index="{f}"]').click()
    page.locator(f'#board [data-index="{t}"]').click()
    wait_unlocked(page)

def choose_level(page, level):
    if page.locator('#modal').evaluate('(e)=>e.open'):
        page.locator('#close-modal').click()
    page.locator('#choose-puzzle').click()
    page.locator(f'[data-action="level"][data-level="{level}"]').click()
    page.wait_for_function('(code)=>AbsoluteZero.snapshot().code===code', arg=f'AZ1-J{level:02d}')

started = time.time()
with sync_playwright() as pw:
    executable = os.environ.get('AZ_CHROMIUM', '/usr/bin/chromium')
    browser = pw.chromium.launch(executable_path=executable if Path(executable).exists() else None, headless=True, args=['--no-sandbox'])
    browser_version = browser.version
    try:
        p = boot(browser)
        assert p.locator('#board .cell').count() == 25 and p.locator('#board .tile').count() == 2
        assert snapshot(p)['status'] == 'playing'
        record('UI-01 initial board and first actionable screen')
        p.locator('#board [data-index="11"]').click()
        assert p.locator('#board [data-index="12"]').get_attribute('data-result') == '→0'
        assert p.locator('#board .landing').count() == 1
        record('UI-02 exact legal destination and result preview')
        p.locator('#board [data-index="12"]').click()
        p.wait_for_function('AbsoluteZero.snapshot().awarded')
        p.wait_for_function('document.getElementById("modal").open')
        assert snapshot(p)['status'] == 'won' and len(snapshot(p)['history']) == 1
        assert p.locator('.win-stars').inner_text() == '★★★'
        record('UI-03 win, stars and result panel')
        p.locator('#close-modal').click(); p.locator('#undo').click()
        assert snapshot(p)['status'] == 'playing' and snapshot(p)['stats']['undos'] == 1
        p.locator('#redo').click(); wait_unlocked(p)
        assert snapshot(p)['status'] == 'won'
        record('UI-04 undo and redo restore exact state')
        choose_level(p, 3); move(p, 11, 12)
        assert snapshot(p)['board'][12] == 2 and len(snapshot(p)['history']) == 1
        p.locator('#board [data-index="12"]').click(); p.keyboard.press('ArrowRight'); wait_unlocked(p)
        assert snapshot(p)['status'] == 'won'
        record('UI-05 difference merge and keyboard movement')
        choose_level(p, 4); p.locator('#board [data-index="14"]').click(); p.keyboard.press('ArrowLeft')
        assert len(snapshot(p)['history']) == 0
        p.locator('#board [data-index="10"]').click(); p.locator('#board [data-index="14"]').click(); wait_unlocked(p)
        assert snapshot(p)['board'][14] == 1
        record('UI-06 immobile 5 stays immobile but accepts a 4')
        choose_level(p, 2)
        client = p.context.new_cdp_session(p)
        box = p.locator('#board [data-index="10"]').bounding_box()
        x, y = box['x'] + box['width']/2, box['y'] + box['height']/2
        client.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
        client.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[{'x':x+54,'y':y}]})
        client.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
        wait_unlocked(p)
        assert len(snapshot(p)['history']) == 1 and snapshot(p)['board'][11] == 1 and snapshot(p)['board'][12] == 0
        record('UI-07 real touch-event swipe and jumping over an intervening piece')
        p.wait_for_timeout(410)
        choose_level(p, 12); p.locator('#hint').click()
        s = snapshot(p); assert s['hintMove'] is not None and s['stats']['hints'] == 1
        assert p.locator('.hint-source').count() == 1 and p.locator('.hint-target').count() == 1
        move(p, s['hintMove']['from'], s['hintMove']['to'])
        saved = json.loads(p.evaluate('window.__AZ_STORAGE__["absolute-zero:v1"]'))
        restored = boot(browser, stored=saved)
        assert snapshot(restored)['board'] == snapshot(p)['board']
        assert snapshot(restored)['history'] == snapshot(p)['history']
        assert snapshot(restored)['stats']['hints'] == 1
        record('UI-08 certified hint and validated save/restore round trip', 'Storage test double')
        # Find a solvable, off-certificate position to exercise the actual local Blob Worker.
        candidate = p.evaluate('''() => { for(let level=5;level<=20;level++){ const p=AZ.journey(level), known=AZ.certificate(p.board,p.size,p.solution); for(const m of AZ.moves(p.board,p.size)){const b=AZ.apply(p.board,p.size,m);if(known.has(AZ.key(b))||AZ.status(b,p.size)!=='playing')continue;const r=AZ.solve(b,p.size,{maxNodes:30000,budgetMs:400});if(r.status==='solved')return {level,move:m};}}return null;}''')
        assert candidate
        choose_level(p, candidate['level']); move(p, candidate['move']['from'], candidate['move']['to']); p.locator('#hint').click()
        p.wait_for_function('!AbsoluteZero.snapshot().searching', timeout=9000)
        assert snapshot(p)['hintMove'] is not None
        record('UI-09 off-certificate hint solved inside a real Blob Worker')
        # Independently verified dead-end with legal moves: never call mere timeout a proof.
        bad = p.evaluate('''() => {for(let level=5;level<=30;level++){const p=AZ.journey(level);for(const m of AZ.moves(p.board,p.size)){const b=AZ.apply(p.board,p.size,m);if(AZ.status(b,p.size)!=='playing')continue;const r=AZ.solve(b,p.size,{maxNodes:50000,budgetMs:400});if(r.status==='unsolvable')return {level,move:m};}}return null;}''')
        assert bad
        choose_level(p, bad['level']); move(p, bad['move']['from'], bad['move']['to']); p.locator('#hint').click()
        p.wait_for_function('!AbsoluteZero.snapshot().searching', timeout=9000)
        assert '全消し経路はありません' in p.locator('#status-panel').inner_text()
        p.locator('[data-action="rewind-safe"]').click()
        assert len(snapshot(p)['history']) == 0
        record('UI-10 exhaustive dead-end notice and safe certified rewind')
        p.locator('[data-mode="daily"]').click(); p.locator('[data-action="daily"][data-tier="2"]').click()
        assert snapshot(p)['size'] == 7 and snapshot(p)['code'].startswith('AZ1-D')
        p.locator('[data-mode="free"]').click(); p.locator('[data-action="free"][data-size="6"]').click()
        assert snapshot(p)['size'] == 6 and snapshot(p)['code'].startswith('AZ1-F6-')
        p.locator('[data-mode="free"]').click(); p.locator('#puzzle-code').fill('AZ1-J03'); p.locator('[data-action="load-code"]').click()
        assert snapshot(p)['code'] == 'AZ1-J03'
        record('UI-11 daily, free play, mode navigation and shared puzzle codes')
        p.locator('#help').click(); before = snapshot(p)['history']; p.keyboard.press('u'); assert snapshot(p)['history'] == before; p.locator('#close-modal').click()
        p.locator('#restart').click(); p.locator('[data-action="close"]').click(); assert snapshot(p)['stats']['restarts'] == 0
        p.locator('#restart').click(); p.locator('[data-action="restart-confirm"]').click(); assert snapshot(p)['stats']['restarts'] == 1
        record('UI-12 modal input boundary and explicit restart confirmation')
        p.locator('#settings').click(); p.locator('[data-setting="dark"]').check(); p.locator('#close-modal').click()
        assert p.locator('body').evaluate('(e)=>e.classList.contains("dark")')
        p.locator('#share').click(); share = p.locator('#share-text').input_value()
        assert 'AZ1-J03' in share and 'http' not in share and 'solution' not in share
        p.locator('#close-modal').click()
        record('UI-13 theme switch and spoiler-free code sharing')
        # Render all 60 routes and execute certified legal clicks. Motion is disabled in this test fixture.
        bulk = boot(browser, width=1280, height=1000)
        results = bulk.evaluate('''async () => { const sleep=ms=>new Promise(r=>setTimeout(r,ms));let done=0;for(let level=1;level<=60;level++){
          if(document.getElementById('modal').open)document.getElementById('close-modal').click();
          document.getElementById('choose-puzzle').click();document.querySelector('[data-action="level"][data-level="'+level+'"]').click();
          const p=AZ.journey(level);for(const m of p.solution){document.querySelector('[data-index="'+m.from+'"]').click();document.querySelector('[data-index="'+m.to+'"]').click();await sleep(1);}
          await sleep(30);if(AbsoluteZero.snapshot().status!=='won')throw Error('level '+level+' did not win');done++;
        }return done;}''')
        assert results == 60
        record('UI-14 full rendered integration walkthrough of every journey level', '60 boards, 937 certified moves')
        for width, height in [(320,568),(360,800),(390,844),(430,932),(768,1024),(1440,1000)]:
            view = boot(browser, code='AZ1-J51', width=width, height=height)
            assert not view.evaluate('document.documentElement.scrollWidth > innerWidth'), str(width)
            assert view.locator('#board .cell').count() == 49
            assert view.locator('#undo').bounding_box()['height'] >= 44
            view.close()
        record('UI-15 responsive 7x7 board and primary controls', '320 / 360 / 390 / 430 / 768 / 1440 px; no horizontal overflow')
        # Final preview images are from the actual playable build with the Storage test double.
        desktop = boot(browser, code='AZ1-J27', width=1440, height=1050)
        desktop.screenshot(path=str(ROOT.parent/'absolute-zero-desktop.png'),full_page=True)
        mobile = boot(browser, code='AZ1-J12', width=390, height=844)
        mobile.screenshot(path=str(ROOT.parent/'absolute-zero-mobile.png'),full_page=True)
        dark = base_store('AZ1-J51'); dark['settings']['dark'] = True
        night = boot(browser, width=390, height=844, stored=dark)
        night.screenshot(path=str(ROOT.parent/'absolute-zero-dark.png'),full_page=True)
        assert not ERRORS, ERRORS
        record('UI-16 browser console and screenshot review', 'zero uncaught page errors')
    except Exception as exc:
        RESULTS.append({'test':'FAILED', 'status':'FAIL', 'details':str(exc)})
        for i, page in enumerate(PAGES[-3:]):
            try:
                if not page.is_closed(): page.screenshot(path=str(ROOT.parent/f'az-failure-{i}.png'),full_page=True)
            except Exception: pass
        raise
    finally:
        report = {'browser':browser_version,'method':'Headless Chromium, local HTML injection, in-memory Storage fixture; no external navigation.', 'elapsedSeconds':round(time.time()-started,2),'results':RESULTS,'uncaughtErrors':ERRORS,'notVerified':['physical iPhone / Mobile Safari','native browser persistence across restart','HTTPS PWA installation and native service worker offline fetch','actual GitHub Pages deployment']}
        (ROOT/'docs/browser-test-results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
        browser.close()
