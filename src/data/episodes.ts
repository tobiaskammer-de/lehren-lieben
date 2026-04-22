export type Episode = {
  show: 'Bester Job der Welt' | 'Ausgezeichnete Lehrkräfte';
  cls: 'amber' | 'teal';
  ep: string;
  title: string;
  desc: string;
  dur: string;
  url: string;
};

export const episodes: Episode[] = [
  {
    show: 'Bester Job der Welt',
    cls: 'amber',
    ep: '#17',
    title: 'Ferien-Talk: Rebellentreff und Rückenwind',
    desc: 'Alex und Tobi nehmen euch hinter die Kulissen — und verraten die erste Maxime guter Lehrkraftarbeit.',
    dur: '42 min',
    url: 'https://lehrkraftbesterjobderwelt.podigee.io/18-17-ferientalk',
  },
  {
    show: 'Bester Job der Welt',
    cls: 'amber',
    ep: '#16',
    title: 'Focus on the Good — Biancas Weg',
    desc: 'Wie Bianca Weber eine Schule nach Corona zu agilem Projektlernen gebracht hat. Die Taufpatin dieses Podcasts im Gespräch.',
    dur: '60 min',
    url: 'https://lehrkraftbesterjobderwelt.podigee.io/16-bianca-schule-neu-denken',
  },
  {
    show: 'Bester Job der Welt',
    cls: 'amber',
    ep: '#15',
    title: 'Deutscher Lehrkräftepreis 2026 — Tobi plaudert aus dem Nähkästchen',
    desc: 'Tobi war dabei — und teilt seine Eindrücke von einer der inspirierendsten Bildungsveranstaltungen des Jahres.',
    dur: '51 min',
    url: 'https://lehrkraftbesterjobderwelt.podigee.io/15-neue-episode',
  },
  {
    show: 'Ausgezeichnete Lehrkräfte',
    cls: 'teal',
    ep: '#8',
    title: 'Dr. Tagrid Yousef — Fachfrau für Lehrkräftegesundheit',
    desc: 'Preisträgerin 2012 und Hirnforscherin. Über Transparenz, Beziehungsarbeit und warum sie seit 2014 neue Wege geht.',
    dur: '55 min',
    url: 'https://deutschlandsausgezeichnetelaehrkraefte.podigee.io/8-new-episode',
  },
  {
    show: 'Ausgezeichnete Lehrkräfte',
    cls: 'teal',
    ep: '#7',
    title: 'Tobias Rusteberg — Französisch und Deutsch',
    desc: 'Was passiert, wenn eine Lehrkraft ihren „Zweck der Existenz" findet? Eine Folge voller Inspiration.',
    dur: '62 min',
    url: 'https://deutschlandsausgezeichnetelaehrkraefte.podigee.io/7-new-episode',
  },
];
