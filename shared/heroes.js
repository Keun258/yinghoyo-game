// 《应猴传说：高塘爆破战》英雄定义 — 服务器与客户端共享
export const HEROES = {
  yinghao: {
    id: 'yinghao', name: '应豪', faction: 'monkey', color: '#ff5a5a',
    hp: 100, speed: 5.6,
    weapon: { name: '橡皮连发弩', dmg: 9, interval: 0.11, spread: 0.02, range: 60, pellets: 1 },
    skill: { name: '弹猴突袭', cd: 12, desc: '向前猛冲8米，撞击伤害+击退' },
    passiveDesc: '击杀后3秒移速+30%',
  },
  houliu: {
    id: 'houliu', name: '猴六', faction: 'monkey', color: '#8bc34a',
    hp: 100, speed: 5.4,
    weapon: { name: '猴式冲锋枪', dmg: 13, interval: 0.16, spread: 0.025, range: 50, pellets: 1 },
    skill: { name: '毒气烟雾弹', cd: 14, desc: '投掷毒气弹：直径6米毒雾持续8秒，遮挡视线+每秒8伤害' },
    passiveDesc: '毒气攻心：自己的毒气对自己同样生效',
  },
  dongdiwen: {
    id: 'dongdiwen', name: '东帝汶', faction: 'timor', color: '#c77dff',
    hp: 100, speed: 5.5,
    weapon: { name: '蚊针冲锋枪', dmg: 11, interval: 0.12, spread: 0.03, range: 25, pellets: 1, falloffStart: 10, falloffMin: 0.4 },
    skill: { name: '变身蚊子', cd: 15, desc: '飞行6秒，期间造成伤害的30%转化为自身血量' },
    passiveDesc: '免疫跌落伤害',
  },
  dadiwen: {
    id: 'dadiwen', name: '大帝汶', faction: 'timor', color: '#4da6ff',
    hp: 100, speed: 5.2,
    weapon: { name: '帝汶霰弹枪', dmg: 5, interval: 0.9, spread: 0.09, range: 18, pellets: 6 },
    skill: { name: '卫蚊哨戒', cd: 18, desc: '放置蚊群哨戒炮（60血），自动攻击12米内敌人' },
    passiveDesc: '蚊群护体：受到的击退效果减半',
  },
  wangchengxue: {
    id: 'wangchengxue', name: '忘成雪', faction: 'neutral', color: '#7de8ff',
    hp: 100, speed: 5.4,
    weapon: { name: '冰晶步枪', dmg: 34, interval: 0.85, spread: 0.005, range: 80, pellets: 1 },
    skill: { name: '冰霜新星', cd: 13, desc: '冻结周围6米敌人，减速60%持续3秒' },
    passiveDesc: '对被减速的敌人伤害+20%',
  },
  zhangjiaxuan: {
    id: 'zhangjiaxuan', name: '胀佳选', faction: 'neutral', color: '#ffd54d',
    hp: 125, speed: 5.2,
    weapon: { name: '肃清霰弹枪', dmg: 7, interval: 1.0, spread: 0.1, range: 15, pellets: 8 },
    skill: { name: '金甲', cd: 15, desc: '6秒内减伤50%，但移速降低30%' },
    passiveDesc: '血量上限125',
  },
};

export const FACTIONS = {
  monkey: { name: '机械猴子', color: '#ff5a5a', role: '进攻方（播放搏击操）' },
  timor: { name: '帝汶家族', color: '#4da6ff', role: '防守方（阻止/拆包）' },
};

export function heroPool(teamSide) {
  // teamSide: 'monkey' | 'timor' → 该阵营专属 + 中立
  return Object.values(HEROES).filter(h => h.faction === teamSide || h.faction === 'neutral');
}
