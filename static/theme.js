// 화면이 깜빡이지 않도록, 그리기 전에 고른 테마부터 적용 (기본: 밝게, 어둡게를 고른 사람만 어둡게)
try { if (localStorage.getItem("tf-theme") === "dark") document.documentElement.dataset.theme = "dark"; } catch (e) {}
