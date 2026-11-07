import re
f = open('templates/index.html', 'r', encoding='utf-8').read()
lines = f.split('\n')

# Find showModelKBPopup
for i, line in enumerate(lines, 1):
    if 'function showModelKBPopup' in line:
        print(f'showModelKBPopup: line {i}')
    if 'function closeModelKBPopup' in line:
        print(f'closeModelKBPopup: line {i}')
    if 'window.showModelKBPopup' in line:
        print(f'window.showModelKBPopup: line {i}')
    if 'window.closeModelKBPopup' in line:
        print(f'window.closeModelKBPopup: line {i}')
    if 'galleryModelGroup' in line and 'function' in line:
        print(f'galleryModelGroup: line {i}')
    if 'function loadGalleryModel' in line:
        print(f'loadGalleryModel: line {i}')
    if 'function animate()' in line:
        print(f'animate: line {i}')
    if 'renderer.render' in line:
        print(f'renderer.render: line {i}')
    if 'activeScene' in line and '=' in line and 'gallery' in line:
        print(f'activeScene = gallery: line {i}')
    if 'canvas-container' in line and 'addEventListener' in line:
        print(f'canvas addEventListener: line {i}')
    if 'function navigateTo3DModel' in line:
        print(f'navigateTo3DModel: line {i}')
    if 'quizNavTo3DFromKBList' in line:
        print(f'quizNavTo3DFromKBList: line {i}')
    if 'navigateTo3DModel' in line and 'function' in line:
        print(f'navigateTo3DModel: line {i}')
    if 'quiz-panel' in line.lower() and 'id=' in line:
        print(f'quiz-panel: line {i}')
    if 'quiz-battle-area' in line:
        print(f'quiz-battle-area: line {i}')
    if 'quizShowSoloPanel' in line:
        print(f'quizShowSoloPanel: line {i}')
    if 'class="nav-search"' in line or 'id="nav-search"' in line:
        print(f'nav-search: line {i}')
    if 'global-search' in line.lower():
        print(f'global-search: line {i}')
    if 'onclick="quizNavTo3DFromKBList' in line:
        print(f'onclick quizNavTo3DFromKBList: line {i}')
    if 'onclick="quizNavToQuizByCat' in line:
        print(f'onclick quizNavToQuizByCat: line {i}')
    if 'onclick="quizJumpToKBFromWrong' in line:
        print(f'onclick quizJumpToKBFromWrong: line {i}')
    if 'onclick="quizNavTo3DFromWrong' in line:
        print(f'onclick quizNavTo3DFromWrong: line {i}')