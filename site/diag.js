(function(){
  var p = document.getElementById('o');
  p.textContent = '外链脚本已执行，JS OK。时间：' + new Date().toISOString();
  console.log('diag ok');
})();