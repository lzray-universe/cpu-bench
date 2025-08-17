(function(){
  document.body.style.fontFamily='system-ui,Segoe UI,Roboto';
  document.body.style.margin='2rem';
  var p=document.createElement('p');
  p.textContent='这是备用页面（外链脚本）。如果你的环境禁止内联脚本，请使用本页；点击下方按钮进入测试页。';
  var a=document.createElement('a'); a.textContent='打开单文件测试页'; a.href='./index.html'; a.style.display='block'; a.style.marginTop='1rem';
  document.getElementById('mount').appendChild(p); document.getElementById('mount').appendChild(a);
})();