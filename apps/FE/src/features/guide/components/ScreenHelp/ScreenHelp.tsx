import { Link } from 'react-router';
import { HELP_TEXT, SCREEN_HELP, type ScreenHelpKey } from '../../content';
import styles from './ScreenHelp.module.css';

export interface ScreenHelpProps {
  screen: ScreenHelpKey;
}

/**
 * 화면 도움말 내용(F-GD-02, D-29): 이 화면에서 할 일 · 다음 단계 · 자주 막히는 곳. `PageHeader`의 `help`나
 * 여정 화면 틀의 도움말 판 안에 넣는다. 글은 content.ts `SCREEN_HELP`(= 안내문구.md §5).
 */
export function ScreenHelp({ screen }: ScreenHelpProps) {
  const help = SCREEN_HELP[screen];
  return (
    <div className={styles.grid} data-screen={screen}>
      <div className={styles.column}>
        <h3 className={styles.heading}>{HELP_TEXT.todo}</h3>
        <ul className={styles.list}>
          {help.todo.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      </div>
      <div className={styles.column}>
        <h3 className={styles.heading}>{HELP_TEXT.next}</h3>
        <ul className={styles.list}>
          {help.next.map((item) => (
            <li key={item.text}>
              {item.text}
              {item.link ? (
                <>
                  {' '}
                  <Link to={item.link.to} className={styles.link}>
                    {item.link.label}
                  </Link>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
      <div className={styles.column}>
        <h3 className={styles.heading}>{HELP_TEXT.stuck}</h3>
        <ul className={styles.list}>
          {help.stuck.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
