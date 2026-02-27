import configs from './eslint.config.js';
configs.forEach((c, i) => {
  if (c.rules) {
    const keys = Object.keys(c.rules).filter(r => r.includes('preserve') || r.includes('@'));
    if (keys.length > 0) {
      console.log(`Config ${i} ${c.name || ''} has rules matching:`);
      console.log(keys.filter(r => r.includes('preserve-caught-error')));
    }
  }
});
