/*
 * reader-ui.js — the shared behaviour behind the reader features.
 *
 * Provides:
 *
 *   ReaderUI.initSettingsPanel()   the reading-settings panel
 *   ReaderUI.initProgressTracker() the reading-progress indicator
 *   ReaderUI.initBookmarkButton()  the bookmark toggle on an article
 *   ReaderUI.renderSavedList()     the list of bookmarks / progress entries
 *   ReaderUI.initDataPanel()       the "your saved reading data" panel
 *
 * All of it is written to DOM through createElement and textContent. No
 * value that comes from the API or from storage is ever interpolated into
 * innerHTML.
 */
(function (root) {
  'use strict';

  var ReaderData = root.ReaderData;
  if (!ReaderData) {
    throw new Error('reader-ui.js requires reader-data.js to be loaded first.');
  }

  // How often the scroll position is written to storage. The reader may
  // scroll hundreds of times a second; the position is only worth saving a
  // few times a minute.
  var SAVE_DEBOUNCE_MS = 1200;

  // A stored position is only restored when the reader had actually read
  // some of the article. Below this, restoring would look like a glitch.
  var MIN_RESTORE_RATIO = 0.02;

  // An article the reader has effectively finished is not restored to the
  // end; it is remembered as complete.
  var COMPLETE_RATIO = 0.97;

  var el = function (id) { return document.getElementById(id); };

  var create = function (tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };

  /** Briefly show a message in a status region. */
  var announce = function (node, message, isError) {
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('is-error', Boolean(isError));
    if (message) {
      root.setTimeout(function () {
        if (node.textContent === message) {
          node.textContent = '';
            node.classList.remove('is-error');
        }
      }, 4000);
    }
  };

  // ==========================================================================
  // Reading settings
  // ==========================================================================

  var ReaderUI = {};

  /**
   * Build the reading-settings panel inside the given container.
   *
   * The panel holds three controls: the text size, the reading width and a
   * reduced-intensity switch. Each is a real form control inside a fieldset,
   * so the group is announced properly and the arrow keys move between the
   * radio options.
   */
  ReaderUI.buildSettingsPanel = function (container, options) {
    if (!container) return null;
    var opts = options || {};

    var panel = create('div', 'reader-settings-panel');
    panel.id = 'reader-settings-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Reading settings');
    panel.setAttribute('aria-modal', 'false');

    // --- Text size ---
    var sizeGroup = create('fieldset', 'reader-settings-group');
    var sizeLegend = create('legend', 'reader-settings-legend', 'Text size');
    sizeGroup.appendChild(sizeLegend);

    var sizeOptions = create('div', 'reader-settings-options');
    var sizeLabels = {
      small: 'Small',
      medium: 'Medium',
      large: 'Large',
      xlarge: 'Extra large',
    };

    Object.keys(ReaderData.TEXT_SIZES).forEach(function (key) {
      var label = create('label', 'reader-option');
      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'reader-text-size';
      input.value = key;
      label.appendChild(input);
      label.appendChild(document.createTextNode(sizeLabels[key] || key));
      sizeOptions.appendChild(label);
    });
    sizeGroup.appendChild(sizeOptions);
    panel.appendChild(sizeGroup);

    // --- Reading width ---
    var widthGroup = create('fieldset', 'reader-settings-group');
    var widthLegend = create('legend', 'reader-settings-legend', 'Reading width');
    widthGroup.appendChild(widthLegend);

    var widthOptions = create('div', 'reader-settings-options');
    var widthLabels = {
      narrow: 'Narrow',
      normal: 'Normal',
      wide: 'Wide',
    };

    Object.keys(ReaderData.READING_WIDTHS).forEach(function (key) {
      var label = create('label', 'reader-option');
      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'reader-reading-width';
      input.value = key;
      label.appendChild(input);
      label.appendChild(document.createTextNode(widthLabels[key] || key));
      widthOptions.appendChild(label);
    });
    widthGroup.appendChild(widthOptions);
    panel.appendChild(widthGroup);

    // --- Reduced intensity ---
    var intensityGroup = create('fieldset', 'reader-settings-group');
    var intensityLegend = create('legend', 'reader-settings-legend', 'Visual intensity');
    intensityGroup.appendChild(intensityLegend);

    var intensityLabel = create('label', 'reader-option-check');
    var intensityInput = document.createElement('input');
    intensityInput.type = 'checkbox';
    intensityInput.name = 'reader-reduced-intensity';
    intensityLabel.appendChild(intensityInput);
    intensityLabel.appendChild(
      document.createTextNode('Reduce grain and shadow effects')
    );
    intensityGroup.appendChild(intensityLabel);
    panel.appendChild(intensityGroup);

    // --- Footer ---
    var footer = create('div', 'reader-settings-footer');
    var note = create(
      'p',
      'reader-settings-note',
      'These settings are kept in this browser only. They are not synchronized to your other devices.'
    );
    var reset = create('button', 'reader-data-action', 'Reset');
    reset.type = 'button';
    footer.appendChild(note);
    footer.appendChild(reset);
    panel.appendChild(footer);

    container.appendChild(panel);

    // --- Behaviour ---

    var apply = function () {
      var prefs = ReaderData.getPreferences();

      Array.prototype.forEach.call(
        panel.querySelectorAll('input[name="reader-text-size"]'),
        function (input) { input.checked = input.value === prefs.textSize; }
      );
      Array.prototype.forEach.call(
        panel.querySelectorAll('input[name="reader-reading-width"]'),
        function (input) { input.checked = input.value === prefs.readingWidth; }
      );
      intensityInput.checked = prefs.reducedIntensity;

      ReaderData.applyPreferences(document);
    };

    var handle = function (key, value) {
      var result = ReaderData.setPreference(key, value);
      if (result.ok) {
        ReaderData.applyPreferences(document);
        if (opts.onChange) opts.onChange(key, value);
      } else if (opts.onError) {
        opts.onError(result.error);
      }
    };

    sizeGroup.addEventListener('change', function (event) {
      if (event.target && event.target.name === 'reader-text-size') {
        handle('textSize', event.target.value);
      }
    });

    widthGroup.addEventListener('change', function (event) {
      if (event.target && event.target.name === 'reader-reading-width') {
        handle('readingWidth', event.target.value);
      }
    });

    intensityInput.addEventListener('change', function () {
      handle('reducedIntensity', intensityInput.checked);
    });

    reset.addEventListener('click', function () {
      ReaderData.resetPreferences();
      apply();
      if (opts.onChange) opts.onChange('reset', null);
    });

    // Close the panel when the Escape key is pressed.
    panel.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        panel.hidden = true;
        if (opts.toggleButton) opts.toggleButton.focus();
      }
    });

    apply();
    return panel;
  };

  /**
   * Wire a button to open and close the settings panel.
   */
  ReaderUI.initSettingsPanel = function (options) {
    var opts = options || {};
    var toggle = opts.toggleButton || el('reader-settings-toggle');
    if (!toggle) return null;

    // The panel is placed in a positioned wrapper so it can sit under the
    // button without disturbing the page layout.
    var host = opts.host || toggle.parentElement;
    if (!host) return null;
    if (root.getComputedStyle(host).position === 'static') {
      host.style.position = 'relative';
    }

    var panel = ReaderUI.buildSettingsPanel(host, {
      toggleButton: toggle,
      onChange: opts.onChange,
      onError: opts.onError,
    });

    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', panel.id);

    var setOpen = function (open) {
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    };

    toggle.addEventListener('click', function (event) {
      event.stopPropagation();
      setOpen(panel.hidden);
    });

    document.addEventListener('click', function (event) {
      if (!panel.hidden && !panel.contains(event.target) && event.target !== toggle) {
        setOpen(false);
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !panel.hidden) {
        setOpen(false);
        toggle.focus();
      }
    });

    return panel;
  };

  // ==========================================================================
  // Reading progress
  // ==========================================================================

  /**
   * Track how far through the article the reader has got.
   *
   * The measurement is a scroll ratio: how much of the article's own
   * scrollable height is above the viewport. It is recalculated on scroll,
   * but only written to storage once the debounce timer expires, so a
   * long scroll does not produce hundreds of writes.
   */
  ReaderUI.initProgressTracker = function (options) {
    var opts = options || {};
    var slug = opts.slug;
    if (!slug) return null;

    var article = opts.article || el('post-content');
    var fill = opts.fill || el('reader-progress-fill');
    var label = opts.label || el('reader-progress-label');
    var status = opts.status || el('reader-progress-status');
    var resetButton = opts.resetButton || el('reader-progress-reset');

    if (!article) return null;

    var restoring = false;
    var timer = null;
    var lastSavedRatio = 0;
    var restored = false;

    /**
     * The fraction of the article that is behind the reader.
     *
     * For an article shorter than the viewport this is 1 as soon as it can
     * be read, because there is nothing to scroll.
     */
    var measure = function () {
      var rect = article.getBoundingClientRect();
      var top = rect.top + root.scrollY;
      var height = article.offsetHeight;
      var viewport = root.innerHeight;

      if (!height || height <= viewport) {
        // The whole article fits on screen: it has been read.
        return 1;
      }

      var scrolled = root.scrollY - top;
      if (scrolled <= 0) return 0;

      var scrollable = height - viewport;
      if (scrollable <= 0) return 1;

      var ratio = scrolled / scrollable;
      if (ratio < 0) ratio = 0;
      if (ratio > 1) ratio = 1;
      return ratio;
    };

    var showProgress = function (ratio) {
      var percent = Math.round(ratio * 100);
      if (fill) fill.style.width = percent + '%';
      if (label) label.textContent = percent + '% read';
      var bar = opts.bar || document.getElementById('reader-progress-bar');
      if (bar && bar.setAttribute) bar.setAttribute('aria-valuenow', String(percent));
    };

    var save = function () {
      var ratio = measure();
      showProgress(ratio);

      // An article that fits on one screen is never worth restoring, so
      // nothing is written for it.
      if (ratio <= 0) return;

      // A short article is fully visible at once: it is remembered as read
      // rather than as a position, so the reader is not sent back to the
      // end of it on the next visit.
      var isShortArticle = article.offsetHeight <= root.innerHeight;

      lastSavedRatio = ratio;
      if (!isShortArticle) {
        ReaderData.setProgress(slug, ratio, Math.round(ratio * 100));
      }

      if (status) {
        status.hidden = false;
      }
      // The reset control is only meaningful when there is something to
      // reset, so it appears exactly when a position was saved.
      if (resetButton) {
        resetButton.hidden = isShortArticle;
      }
      if (isShortArticle && label) {
        label.textContent = 'Read in full';
      }
    };

    var scheduleSave = function () {
      if (restoring) return;
      if (timer) root.clearTimeout(timer);
      timer = root.setTimeout(function () {
        timer = null;
        save();
      }, SAVE_DEBOUNCE_MS);
    };

    /**
     * Put the reader back where they left off.
     *
     * The saved ratio is validated against the article's current height
     * before it is used, and the restore is flagged so that the scroll
     * handler does not immediately save the position it just restored
     * (which would otherwise create a loop).
     */
    var restore = function () {
      var stored = ReaderData.getProgress(slug);
      if (!stored) {
        showProgress(measure());
        if (status) status.hidden = true;
        if (resetButton) resetButton.hidden = true;
        return;
      }

      var ratio = stored.r;
      if (typeof ratio !== 'number' || !isFinite(ratio) || ratio < 0 || ratio > 1) {
        // A corrupt position is discarded rather than used.
        ReaderData.removeProgress(slug);
        showProgress(measure());
        if (status) status.hidden = true;
        if (resetButton) resetButton.hidden = true;
        return;
      }

      // A reader who has finished the article is not sent back to the end.
      if (ratio >= COMPLETE_RATIO) {
        showProgress(1);
        if (status) status.hidden = false;
        if (label) label.textContent = 'Read in full';
        if (resetButton) resetButton.hidden = false;
        restored = true;
        return;
      }

      // Nothing worth restoring: the reader barely began.
      if (ratio < MIN_RESTORE_RATIO) {
        showProgress(ratio);
        if (status) status.hidden = true;
        if (resetButton) resetButton.hidden = false;
        restored = true;
        return;
      }

      var rect = article.getBoundingClientRect();
      var top = rect.top + root.scrollY;
      var height = article.offsetHeight;
      var viewport = root.innerHeight;
      var scrollable = height - viewport;

      if (scrollable <= 0) {
        showProgress(1);
        restored = true;
        return;
      }

      // The target must still be inside the article, otherwise the article
      // was shortened and the stored position no longer makes sense.
      var target = top + ratio * scrollable;
      var maxScroll = top + height - viewport;
      if (target > maxScroll) target = maxScroll;
      if (target < 0) target = 0;

      restoring = true;
      root.scrollTo(0, target);

      // Release the guard after the browser has settled the scroll.
      root.setTimeout(function () {
        restoring = false;
        showProgress(measure());
      }, 120);

      if (status) status.hidden = false;
      if (resetButton) resetButton.hidden = false;
      restored = true;
    };

    if (resetButton) {
      resetButton.hidden = true;
      resetButton.addEventListener('click', function () {
        if (!root.confirm('Forget how far you had read this entry?')) return;
        ReaderData.removeProgress(slug);
        if (status) {
          status.hidden = true;
        }
        if (label) label.textContent = '0% read';
        if (fill) fill.style.width = '0%';
        if (opts.onReset) opts.onReset();
      });
    }

    var onScroll = function () {
      if (restoring) return;
      scheduleSave();
    };

    root.addEventListener('scroll', onScroll, { passive: true });
    root.addEventListener('resize', function () { scheduleSave(); });

    // The article is rendered asynchronously, so the restore waits for it.
    if (opts.ready) {
      opts.ready.then(restore);
    } else if (document.readyState === 'complete') {
      restore();
    } else {
      root.addEventListener('load', restore);
    }

    return {
      restore: restore,
      save: save,
      measure: measure,
      isRestored: function () { return restored; },
      lastSavedRatio: function () { return lastSavedRatio; },
    };
  };

  // ==========================================================================
  // Bookmarks
  // ==========================================================================

  /**
   * Wire the bookmark button on an article page.
   *
   * The button reflects the current state through aria-pressed, and the
   * label says what the button will do next.
   */
  ReaderUI.initBookmarkButton = function (options) {
    var opts = options || {};
    var slug = opts.slug;
    var button = opts.button || el('reader-bookmark');
    if (!slug || !button) return null;

    var status = opts.status || el('reader-bookmark-status');
    var note = opts.note || el('reader-bookmark-note');

    var render = function () {
      var saved = ReaderData.isBookmarked(slug);
      button.setAttribute('aria-pressed', saved ? 'true' : 'false');
      button.setAttribute(
        'aria-label',
        saved ? 'Remove this entry from your bookmarks' : 'Bookmark this entry'
      );

      var text = button.querySelector('.reader-bookmark-text');
      if (text) {
        text.textContent = saved ? 'Bookmarked' : 'Bookmark';
      }
    };

    button.addEventListener('click', function () {
      var saved = ReaderData.isBookmarked(slug);
      if (saved) {
        ReaderData.removeBookmark(slug);
        render();
        announce(status, 'Removed from your bookmarks.');
        if (opts.onChange) opts.onChange(false);
      } else {
        var result = ReaderData.addBookmark(slug);
        if (result.ok) {
          render();
          announce(status, 'Saved to your bookmarks.');
          if (opts.onChange) opts.onChange(true);
        } else {
          announce(status, result.error || 'The bookmark could not be saved.', true);
        }
      }
    });

    render();
    return { render: render };
  };

  /**
   * Render a list of saved entries.
   *
   * The slugs are resolved through the public API, so only content that is
   * still publicly accessible is shown. An entry whose article has since
   * been unpublished or deleted is shown as unavailable, without its
   * content, and can still be removed.
   */
  ReaderUI.renderSavedList = function (container, slugs, options) {
    var opts = options || {};
    if (!container) return;

    container.textContent = '';

    if (!slugs || slugs.length === 0) {
      var empty = create('div', 'reader-card');
      var emptyBody = create('div', 'reader-card-body');
      emptyBody.appendChild(
        create('h2', 'reader-card-title', opts.emptyTitle || 'Nothing saved yet.')
      );
      emptyBody.appendChild(
        create(
          'p',
          'reader-card-excerpt',
          opts.emptyMessage ||
            'The pages you bookmark will be listed here, ready to reopen.'
        )
      );
      empty.appendChild(emptyBody);
      container.appendChild(empty);
      return;
    }

    slugs.forEach(function (slug) {
      var card = create('article', 'reader-card');
      var body = create('div', 'reader-card-body');

      var title = create('h2', 'reader-card-title');
      var link = create('a', null, 'Loading…');
      link.href = opts.articleUrl ? opts.articleUrl(slug) : '/post.html?slug=' + encodeURIComponent(slug);
      link.setAttribute('aria-label', 'Open the saved entry: ' + slug);
      title.appendChild(link);
      body.appendChild(title);

      var meta = create('p', 'reader-card-meta', '');
      body.appendChild(meta);

      var excerpt = create('p', 'reader-card-excerpt reader-text', '');
      excerpt.hidden = true;
      body.appendChild(excerpt);

      card.appendChild(body);

      var remove = create('button', 'reader-card-remove', 'Remove');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'Remove this saved entry from your bookmarks');
      remove.addEventListener('click', function () {
        if (!root.confirm('Remove this entry from your bookmarks?')) return;
        ReaderData.removeBookmark(slug);
        card.remove();
        if (opts.onRemove) opts.onRemove(slug);
      });
      card.appendChild(remove);

      container.appendChild(card);

      // Resolve the article through the public API.
      fetch(opts.apiBase + '/posts/' + encodeURIComponent(slug))
        .then(function (response) {
          if (response.status === 404) return null;
          if (!response.ok) throw new Error('lookup failed');
          return response.json();
        })
        .then(function (post) {
          if (!post) {
            // The article is gone or is no longer published.
            card.classList.add('reader-card-unavailable');
            link.textContent = slug;
            link.removeAttribute('href');
            meta.textContent = 'Unavailable — this entry is no longer published.';
            return;
          }

          link.textContent = post.title || slug;
          link.setAttribute('aria-label', 'Open the saved entry: ' + (post.title || slug));
          var when = post.publishedAt
            ? new Date(post.publishedAt).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })
            : 'Undated';
          meta.textContent = when;
          if (post.excerpt) {
            excerpt.textContent = post.excerpt;
            excerpt.hidden = false;
          }
        })
        .catch(function () {
          // A failed lookup must not remove the bookmark, and must not
          // show any private content.
          card.classList.add('reader-card-unavailable');
          link.textContent = slug;
          link.removeAttribute('href');
          meta.textContent = 'Could not be loaded. The entry is still saved.';
        });
    });
  };

  // ==========================================================================
  // The saved-data panel
  // ==========================================================================

  /**
   * The panel that shows what is stored and lets the reader clear each kind
   * of data separately.
   */
  ReaderUI.initDataPanel = function (options) {
    var opts = options || {};
    var container = opts.container || el('reader-data-panel');
    if (!container) return null;

    var status = opts.status || null;

    // The status element is created together with the panel, so it is looked
    // up on demand rather than captured before the panel exists.
    var statusNode = function () {
      return status || el('reader-data-status');
    };

    var renderSummary = function () {
      // The host is looked up on every call, because the panel builds it
      // itself and it does not exist yet when this function is created.
      var summaryHost = opts.summaryHost || el('reader-data-summary');
      if (!summaryHost) return;
      var summary = ReaderData.getSummary();
      summaryHost.textContent = '';

      var counts = [
        { value: summary.bookmarks.length, label: 'Bookmarks' },
        { value: Object.keys(summary.progress).length, label: 'Reading positions' },
        { value: summary.storyPaths.length, label: 'Story paths' },
      ];

      counts.forEach(function (item) {
        var wrap = create('div', 'reader-data-count');
        wrap.appendChild(create('span', 'reader-data-count-value', item.value));
        wrap.appendChild(create('span', 'reader-data-count-label', item.label));
        summaryHost.appendChild(wrap);
      });
    };

    var action = function (label, handler, danger) {
      var button = create('button', 'reader-data-action' + (danger ? ' is-danger' : ''), label);
      button.type = 'button';
      button.addEventListener('click', handler);
      return button;
    };

    var build = function () {
      container.textContent = '';

      container.appendChild(
        create('h2', null, opts.title || 'Your saved reading data')
      );
      container.appendChild(
        create(
          'p',
          null,
          'Bookmarks, reading positions and story paths are kept in this browser only. ' +
            'They are not synchronized between devices, and they are lost if you clear this browser’s data.'
        )
      );

      var summary = create('div', 'reader-data-counts');
      summary.id = 'reader-data-summary';
      container.appendChild(summary);

      var actions = create('div', 'reader-data-actions');
      actions.appendChild(
        action('Clear bookmarks', function () {
          if (!root.confirm('Remove every bookmark from this browser?')) return;
          ReaderData.clearBookmarks();
          renderSummary();
          announce(statusNode(), 'Bookmarks cleared. Reading positions and story paths were left alone.');
          if (opts.onChange) opts.onChange('bookmarks');
        })
      );
      actions.appendChild(
        action('Clear reading positions', function () {
          if (!root.confirm('Remove every saved reading position from this browser?')) return;
          ReaderData.clearProgress();
          renderSummary();
          announce(statusNode(), 'Reading positions cleared. Bookmarks and story paths were left alone.');
          if (opts.onChange) opts.onChange('progress');
        })
      );
      actions.appendChild(
        action('Reset settings', function () {
          if (!root.confirm('Return the reading settings to their defaults?')) return;
          ReaderData.resetPreferences();
          ReaderData.applyPreferences(document);
          renderSummary();
          announce(statusNode(), 'Settings reset. Bookmarks and reading positions were left alone.');
          if (opts.onChange) opts.onChange('preferences');
        })
      );
      actions.appendChild(
        action('Clear everything', function () {
          if (
            !root.confirm(
              'Remove all bookmarks, reading positions and story paths from this browser? ' +
                'This cannot be undone.'
            )
          ) {
            return;
          }
          ReaderData.clearBookmarks();
          ReaderData.clearProgress();
          ReaderData.clearStoryPaths();
          renderSummary();
          announce(statusNode(), 'All saved reading data was cleared from this browser.');
          if (opts.onChange) opts.onChange('all');
        }, true)
      );
      container.appendChild(actions);

      var statusLine = create('p', 'reader-data-status');
      statusLine.id = 'reader-data-status';
      container.appendChild(statusLine);

      renderSummary();
    };

    build();
    return { rebuild: build, renderSummary: renderSummary };
  };

  root.ReaderUI = ReaderUI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
