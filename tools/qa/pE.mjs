// Phase E: Marerijk II (steps 58-62): PARDIJNTJE, DRAAK1 (helper + STEEN, ring 4), TROLLENKONING1 banana.
import { mk } from './lib.mjs';
export default async (ctx) => {
  const q = mk(ctx);
  const { wait, note, check, S, V, go, clickT, settle, use, useHelper, shot } = q;
  note('# pE from pD-ghost');
  await q.bootSave('pD-ghost', { $RATTAR_APPEARS: 9999 });
  let s;
  await q.clickSprite('SK1_KAST', [563, 145]); await settle({ max: 30000 }); // PARDIJN trigger
  s = await S(); check('helper PARDIJNTJE', s.help === 'PARDIJNTJE', s.help);
  check('to KPMARE', await q.toRealm('KPMARE'));
  check('to ELFJES1', await go('CMDKPMAREtoLF1', { expect: 'ELFJES1' }));
  check('to ELFJES2', await go('CMDLF1toLF2', { expect: 'ELFJES2' }));
  await settle({ max: 30000 });
  await shot('pE-lf2');
  check('to DRAAK1', await go('CMDLF2toDR1', { expect: 'DRAAK1' }));
  await shot('pE-dr1');
  await useHelper('CMDDR1RUILSTEEN'); await wait(3000); await settle({ max: 40000 });
  check('dragon calmed ($DR1_FINISHED1)', (await V('$DR1_FINISHED1')) === '1');
  s = await S(); check('PARDIJNTJE consumed', s.help !== 'PARDIJNTJE', s.help);
  await use('STEEN', 'CMDDR1RUILSTEEN'); await wait(3000); await settle({ max: 40000 });
  check('chest opened ($DR1_FINISHED2)', (await V('$DR1_FINISHED2')) === '1');
  await shot('pE-dr1-open');
  await go('DR1KRING');
  s = await S(); check('ring 4', s.rings.includes('4'), s.rings);
  check('to VILLAVOLTA1', await go('CMDDR1toVV1', { expect: 'VILLAVOLTA1' }));
  check('to KPMARE', await go('CMDVV1toKPMARE', { expect: 'KPMARE' }));
  check('to TROLLENKONING1', await go('CMDKPMAREtoTK1', { expect: 'TROLLENKONING1' }));
  await go('TK1OBJGRND');
  s = await S(); check('BANAAN in the bag', s.inv.includes('BANAAN'), s.inv);
  await shot('pE-tk1');
  check('to KPMARE', await go('CMDTK1toKPMARE', { expect: 'KPMARE' }));
  check('to STERRENKAMER', await go('CMDKPMAREtoSK', { expect: 'STERRENKAMER' }));
  await q.st('end');
  await q.saveTo('pE');
  return q.done();
};
