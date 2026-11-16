// 화면이 깜빡이지 않도록, 그리기 전에 고른 테마부터 적용 (기본: 어둡게)
try { if (localStorage.getItem("tf-theme") === "light") document.documentElement.dataset.theme = "light"; } catch (e) {}
